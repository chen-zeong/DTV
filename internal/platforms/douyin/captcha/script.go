package captcha

import "strings"

// 本文件集中存放验证码窗口与常驻浏览器共用的注入脚本。
//
// 两处窗口的脚本逻辑几乎相同，差别只在:
//   - 回传消息的前缀（dtv:xxx: 与 dtv:browser-xxx:）
//   - 直播间号的取法（URL 里已带 webRID vs 从 URL 里正则抓）
//   - 未开播的判定轮数（见 captcha.go 的 offlineRoundsPopup / browser.go 的 offlineRoundsBrowser）
// 所以统一用参数化函数生成，差异用参数传进去。

// reportIntervalMS 注入脚本轮询间隔（毫秒）
const reportIntervalMS = "600"

// 注入脚本单个直播间的挂钟时间上限（毫秒）
//
// 必须小于对应的 Go 预算（常驻 doResolve 20s / 弹窗另算），同时 ≥
// offlineRounds* × reportIntervalMS，否则脚本还没数满轮数就被 deadline
// 提前截断，轮数阈值形同虚设。
const (
	browserDeadlineMS = "12000"
	popupDeadlineMS   = "3000"
)

// 未开播判定轮数（页面已加载完、没有任何在播迹象、也没 roomId）
// browserRounds * reportIntervalMS (ms) ≈ 12s，覆盖冷启动时抖音 SPA hydration 慢的情况
// 必须小于 doResolve 的 20s 预算，否则脚本还未结束 Go 先超时
// popupRounds * reportIntervalMS (ms) 必须小于 captchaFallbackDelay
const (
	browserRounds = "20"
	popupRounds   = "5"
)

// 两个验证码窗口的尺寸
//
// 一次性弹窗与常驻浏览器用同一套尺寸，抖音验证码卡片约 470×510，
// 加上标题栏 46px 与两侧余量
const (
	captchaWindowWidth  = 520
	captchaWindowHeight = 640
)

// sendSnippet 是回传消息的公共部分：Wails 的 postMessage 桥接。
//
// 注入脚本跑在抖音页面里，两端 webview 都要支持
const sendSnippet = `function send(msg){` +
	`try{if(window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage){` +
	`window.chrome.webview.postMessage(msg);return true;}}catch(e){}` +
	`try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.external){` +
	`window.webkit.messageHandlers.external.postMessage(msg);return true;}}catch(e){}` +
	`return false;}`

// extractSnippet 是从页面内嵌 JSON 里抠出内部 roomId 的公共部分。
//
// guardJS 是可选的前置守卫（为空则不加）。一次性验证码窗口需要它：
// 中转页 location.replace 之前脚本已经跑了，此时页面还不是目标直播间，
// 抠出来的 roomId 会是别的房间的。
//
// h 是页面 HTML，由调用方传入
const extractSnippet = `function extract(h){` +
	`try{` +
	`%GUARD%` +
	`var m=h.match(/\\"roomId\\":\\"(\d{10,})\\"/);` +
	`if(!m)m=h.match(/"roomId":"(\d{10,})"/);` +
	`if(!m)m=h.match(/\\"room_id\\":\\"(\d{10,})\\"/);` +
	`if(!m){var ss=document.querySelectorAll("script");` +
	`for(var i=0;i<ss.length;i++){var t=ss[i].textContent||"";` +
	`m=t.match(/\\"roomId\\":\\"(\d{10,})\\"/)||t.match(/"roomId":"(\d{10,})"/);` +
	`if(m)break;}}` +
	`return m?m[1]:"";}catch(e){return "";}}`

// extractFn 生成 extract() 函数体，guard 为前置守卫（可为空）。
func extractFn(guard string) string {
	return strings.ReplaceAll(extractSnippet, "%GUARD%", guard)
}

// phaseCountingJS 生成 load/live/idle 三态计数与 offline 上报的脚本块
//
// 弹窗与常驻浏览器共用，差异用参数传
//   - offlineMsgJS: 上报 offline 用的消息 JS 表达式
//     弹窗是字面量，常驻浏览器要拼 JS 变量 rid,
//     如 `"dtv:browser-offline:"+rid`
//   - limit: 判定轮数 (idle/load/live 三者共用同一阈值)
func phaseCountingJS(offlineMsgJS, limit string) string {
	return `if(document.readyState!=="complete"){` +
		`loadRounds++;liveRounds=0;idleRounds=0;` +
		`}else if(hasLiveSign(h)){` +
		`liveRounds++;loadRounds=0;idleRounds=0;` +
		`}else{` +
		`idleRounds++;loadRounds=0;liveRounds=0;` +
		`}` +
		`if(idleRounds>=` + limit + `||loadRounds>=` + limit + `||liveRounds>=` + limit + `||now>=deadline){` +
		`reported=true;send(` + offlineMsgJS + `);return;}`
}

// liveSignSnippet 判断页面是否已经出现正在直播的迹象。
//
// h 由调用方传入
const liveSignSnippet = `function hasLiveSign(h){` +
	`return /\d[\d.]*\s*[万wW]?\s*人(在线|观看)/.test(h);}`

// captchaPageSnippet 判断当前页面是否为抖音的验证码/风控页。
//
// 判据从粗到细：中间页文案、验证码容器与脚本、iframe 的 src、URL 参数。
// 一次性验证码窗口与常驻浏览器共用这一份：常驻浏览器的页面可能已经被
// 重定向到验证页而不是停在中间页，多余的判据对弹窗场景同样无害。
//
// h 由调用方传入
const captchaPageSnippet = `function isCaptchaPage(h){` +
	`try{` +
	`if(h.indexOf("验证码中间页")>=0||h.indexOf("verify_data")>=0)return true;` +
	`if(h.indexOf("captcha-container")>=0)return true;` +
	`if(h.indexOf("captcha/index.js")>=0)return true;` +
	`try{var fr=document.querySelectorAll("iframe");` +
	`for(var i=0;i<fr.length;i++){` +
	`var s=fr[i].getAttribute("src")||"";` +
	`if(s.indexOf("captcha")>=0)return true;}}catch(e){}` +
	`try{var u=window.location?window.location.href:"";` +
	`if(u.indexOf("verify=")>=0||u.indexOf("captcha=")>=0)return true;` +
	`}catch(e){}` +
	`return false;}catch(e){return false;}}`

// chromeJS 给窗口注入与前端扫码登录弹窗同风格的弹窗外壳。
//
// cancelMsg 是点右上角关闭按钮时回传的消息，常驻浏览器用
// dtv:browser-close，一次性验证码窗口用 dtv:cancel:<webRID>。
func chromeJS(mode, cancelMsg string) string {
	return `(function(){` +
		`var done=false;` +
		`function install(){` +
		`if(done)return;` +
		`try{` +
		`if(window.top!==window.self)return;` +
		`var loc=window.location?window.location.href:"";` +
		`if(loc.indexOf("live.douyin.com")<0)return;` +
		`if(!document.body||!document.head)return;` +
		`if(document.getElementById("dtv-captcha-chrome")){done=true;return;}` +
		`done=true;` +
		`var st=document.createElement("style");` +
		`st.textContent="` + chromeCSS(mode) + `";` +
		`document.head.appendChild(st);` +
		`var bar=document.createElement("div");` +
		`bar.id="dtv-captcha-chrome";` +
		`bar.innerHTML=` +
		`'<div class="dtv-bar-left"><span class="dtv-bar-title">抖音人机验证</span><span class="dtv-bar-hint">完成验证后此窗口会自动关闭</span></div>'` +
		`+'<button class="dtv-bar-close" aria-label="关闭" title="关闭">\u2715</button>';` +
		`bar.querySelector(".dtv-bar-close").addEventListener("click",function(){` +
		`var msg="` + cancelMsg + `";` +
		`try{if(window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage){` +
		`window.chrome.webview.postMessage(msg);return;}}catch(e){}` +
		`try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.external){` +
		`window.webkit.messageHandlers.external.postMessage(msg);}}catch(e){}` +
		`});` +
		`document.body.appendChild(bar);` +
		`}catch(e){}}` +
		`function boot(){install();if(!done){setTimeout(boot,300);}}` +
		`boot();})();`
}

// chromeCSS 弹窗外壳的样式
func chromeCSS(mode string) string {
	if mode == "light" {
		return "html,body{background:#f1f2f4 !important;}" +
			"body{padding-top:46px !important;box-sizing:border-box !important;}" +
			"#dtv-captcha-chrome{position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
			"display:flex;align-items:center;justify-content:space-between;" +
			"height:46px;padding:0 10px 0 16px;background:#ffffff;color:#18181b;" +
			"font-family:system-ui,-apple-system,'Segoe UI',sans-serif;" +
			"border-bottom:1px solid #e7e9ed;" +
			"-webkit-app-region:drag;--wails-draggable:drag;}" +
			"#dtv-captcha-chrome .dtv-bar-left{display:flex;align-items:center;min-width:0;}" +
			"#dtv-captcha-chrome .dtv-bar-title{font-size:15px;font-weight:600;letter-spacing:-0.01em;}" +
			"#dtv-captcha-chrome .dtv-bar-hint{margin-left:12px;font-size:12px;color:#63636d;" +
			"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
			"#dtv-captcha-chrome .dtv-bar-close{display:flex;align-items:center;justify-content:center;" +
			"width:30px;height:30px;border:0;border-radius:50%;flex:0 0 auto;" +
			"background:#f0f1f3;color:#52525b;font-size:13px;line-height:1;" +
			"cursor:pointer;-webkit-app-region:no-drag;--wails-draggable:no-drag;" +
			"transition:background .15s,color .15s;}" +
			"#dtv-captcha-chrome .dtv-bar-close:hover{background:#e6e8ec;color:#18181b;}"
	}
	// 深色 (默认)
	return "html,body{background:#101114 !important;}" +
		"body{padding-top:46px !important;box-sizing:border-box !important;}" +
		"#dtv-captcha-chrome{position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
		"display:flex;align-items:center;justify-content:space-between;" +
		"height:46px;padding:0 10px 0 16px;background:#17181d;color:#f2f3f5;" +
		"font-family:system-ui,-apple-system,'Segoe UI',sans-serif;" +
		"-webkit-app-region:drag;--wails-draggable:drag;}" +
		"#dtv-captcha-chrome .dtv-bar-left{display:flex;align-items:center;min-width:0;}" +
		"#dtv-captcha-chrome .dtv-bar-title{font-size:15px;font-weight:600;letter-spacing:-0.01em;}" +
		"#dtv-captcha-chrome .dtv-bar-hint{margin-left:12px;font-size:12px;color:#9aa0a8;" +
		"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
		"#dtv-captcha-chrome .dtv-bar-close{display:flex;align-items:center;justify-content:center;" +
		"width:30px;height:30px;border:0;border-radius:50%;flex:0 0 auto;" +
		"background:rgba(255,255,255,.08);color:#c9ccd1;font-size:13px;line-height:1;" +
		"cursor:pointer;-webkit-app-region:no-drag;--wails-draggable:no-drag;" +
		"transition:background .15s,color .15s;}" +
		"#dtv-captcha-chrome .dtv-bar-close:hover{background:rgba(255,255,255,.16);color:#fff;}"
}

// muteMediaJS 让页面里所有媒体静音
func muteMediaJS() string {
	return `(function(){` +
		`if(window.__dtvMuteInstalled)return;` +
		`window.__dtvMuteInstalled=true;` +
		`function sweep(){` +
		`try{var els=document.querySelectorAll("video,audio");` +
		`for(var i=0;i<els.length;i++){` +
		`try{els[i].muted=true;els[i].volume=0;}catch(e){}` +
		`try{if(!els[i].paused)els[i].pause();}catch(e){}` +
		`}}catch(e){}}` +
		`try{` +
		`var origPlay=HTMLMediaElement.prototype.play;` +
		`HTMLMediaElement.prototype.play=function(){` +
		`try{this.muted=true;this.volume=0;}catch(e){}` +
		`try{return origPlay.apply(this,arguments);}` +
		`catch(e){return Promise.reject(e);}` +
		`};` +
		`}catch(e){}` +
		`sweep();` +
		`setInterval(sweep,800);` +
		`})();`
}
