package captcha

import (
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"dtv/internal/platforms/douyin"
)

// Browser 是一个常驻的隐藏 WebView，用作抖音的浏览器会话

type Browser struct {
	app *application.App

	mu       sync.Mutex
	win      *application.WebviewWindow // 常驻窗口 (懒创建)
	ready    bool                       // 窗口是否已创建
	passed   bool                       // 是否已经放行
	passedAt time.Time
	theme    string

	// sessions 是排队中的解析请求。同一时刻只跑一个 (WebView 导航是串行的)
	sessions map[string]*browserSession
	// active 当前正在解析的直播间
	active string

	// captchaFallback 在常驻浏览器被拦截时手动过验证码
	captchaFallback Resolver
	// inFallback 防止 captcha.Resolve <-> browser.Resolve 循环调用
	inFallback bool

	// createdAt 窗口创建时间
	createdAt time.Time

	// closed 应用退出时表示常驻窗口已被销毁, 并阻止关掉之后再新建窗口
	closed bool

	// 保证同一时刻屏幕上最多只有一个验证码弹窗
	gate *Gate

	// onPendingChange 在"是否有挑战正在进行"时变化时回调
	// 用于通知前端暂停/恢复后台刷新
	onPendingChange func(pending bool)
}

// Resolver 是与 douyin.CaptchaResolver 同形的函数类型
type Resolver func(webRID string) (string, error)

// SetCaptchaFallback 注入验证码解决器
func (b *Browser) SetCaptchaFallback(r Resolver) {
	b.mu.Lock()
	b.captchaFallback = r
	b.mu.Unlock()
}

// beginFallback / endFallback 标记正在处理验证码，防止
// captcha.resolve -> browser.resolve -> captcha.resolve 的死循环。
func (b *Browser) beginFallback() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.inFallback {
		return false
	}
	b.inFallback = true
	return true
}

func (b *Browser) endFallback() {
	b.mu.Lock()
	b.inFallback = false
	b.mu.Unlock()
}

// inFallbackMode 当前是否正在验证码弹窗
//
// 常驻浏览器自己被拦 -> 回调一次性验证码窗口时为 true。
func (b *Browser) inFallbackMode() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.inFallback
}

// browserSession 是一次用常驻 WebView 解析 roomId 的请求
type browserSession struct {
	webRID string
	mu     sync.Mutex
	result string
	done   chan struct{}
	closed bool
	// offline 表示页面正常加载但拿不到 roomId (未开播的蓝V直播间)
	offline bool
	// awaitingUser 表示正在等用户手动通过验证码
	awaitingUser bool
}

// markAwaitingUser 标记正在等用户手动通过验证码
func (s *browserSession) markAwaitingUser() {
	s.mu.Lock()
	s.awaitingUser = true
	s.mu.Unlock()
}

// isAwaitingUser 是否正在等用户手动通过验证码
func (s *browserSession) isAwaitingUser() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.awaitingUser
}

// isFinished 会话是否已经结束 (拿到结果 / 被中止)
func (s *browserSession) isFinished() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// finish 结束会话并广播结果 (幂等)
func (s *browserSession) finish(rid string, offline bool) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.result = rid
	s.offline = offline
	s.mu.Unlock()

	close(s.done)
}

// abort 结束会话但不带结果 (窗口被关 / 排队超时 / 取消)
func (s *browserSession) abort() {
	s.finish("", false)
}

// outcome 取结果 (会话结束后调用)
func (s *browserSession) outcome() (string, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.result, s.offline, s.closed
}

// browserResolveTimeout 是单个直播间用浏览器解析的超时
const browserResolveTimeout = 40 * time.Second

// browserPassTTL 是"放行"状态的有效期
const browserPassTTL = 30 * time.Minute

func NewBrowser(app *application.App) *Browser {
	return &Browser{
		app:      app,
		theme:    "dark",
		sessions: make(map[string]*browserSession),
		gate:     NewGate(),
	}
}

func (b *Browser) SetGate(g *Gate) {
	b.mu.Lock()
	b.gate = g
	b.mu.Unlock()
}

// SetPendingCallback 注册"挑战状态变化"回调。
func (b *Browser) SetPendingCallback(cb func(pending bool)) {
	b.mu.Lock()
	b.onPendingChange = cb
	b.mu.Unlock()
}

// notifyPending 通知前端挑战状态变化
func (b *Browser) notifyPending(_ bool) {
	var pending bool
	b.mu.Lock()
	gate := b.gate
	cb := b.onPendingChange
	b.mu.Unlock()
	if gate != nil {
		pending = gate.Pending()
	}
	if cb != nil {
		cb(pending)
	}
}

// SetThemeMode 同步主题 (验证码窗口)
func (b *Browser) SetThemeMode(mode string) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "dark", "light":
		b.mu.Lock()
		b.theme = strings.ToLower(strings.TrimSpace(mode))
		b.mu.Unlock()
	}
}

// isPassed 当前是否处于放行状态
func (b *Browser) isPassed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.passed {
		return false
	}
	if time.Since(b.passedAt) > browserPassTTL {
		b.passed = false
		return false
	}
	return true
}

func (b *Browser) markPassed() {
	b.mu.Lock()
	b.passed = true
	b.passedAt = time.Now()
	b.mu.Unlock()
}

// resolve 用常驻 WebView 解析 web_rid -> 内部 roomId
func (b *Browser) Resolve(webRID string) (string, error) {
	if webRID == "" {
		return "", fmt.Errorf("直播间号为空")
	}

	s := &browserSession{
		webRID: webRID,
		done:   make(chan struct{}),
	}

	b.mu.Lock()
	if existing, ok := b.sessions[webRID]; ok {
		b.mu.Unlock()
		return b.waitSession(existing)
	}
	b.sessions[webRID] = s
	b.mu.Unlock()

	defer func() {
		b.mu.Lock()
		if b.sessions[webRID] == s {
			delete(b.sessions, webRID)
		}
		b.mu.Unlock()
	}()

	if err := b.waitTurn(s); err != nil {
		s.abort()
		return "", err
	}

	rid, err := b.doResolve(s)
	b.releaseTurn(webRID)
	return rid, err
}

func (b *Browser) releaseTurn(webRID string) {
	b.mu.Lock()
	if b.active == webRID {
		b.active = ""
	}
	b.mu.Unlock()
}

// resolveFast 是带超时的快速解析尝试
func (b *Browser) resolveFast(webRID string, timeout time.Duration) (string, bool) {
	type outcome struct {
		rid string
		ok  bool
	}
	ch := make(chan outcome, 1)
	go func() {
		rid, err := b.Resolve(webRID)
		ch <- outcome{rid: rid, ok: err == nil && rid != ""}
	}()

	select {
	case o := <-ch:
		return o.rid, o.ok
	case <-time.After(timeout):
		return "", false
	}
}

func (b *Browser) waitTurn(s *browserSession) error {
	deadline := time.Now().Add(browserResolveTimeout)
	for {
		b.mu.Lock()
		activeFree := b.active == "" || b.active == s.webRID
		b.mu.Unlock()

		challengeRunning := b.gate != nil && b.gate.Held()

		if activeFree && !challengeRunning {
			b.mu.Lock()
			if b.active == "" || b.active == s.webRID {
				b.active = s.webRID
				b.mu.Unlock()
				return nil
			}
			b.mu.Unlock()
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("等待浏览器队列超时")
		}
		select {
		case <-s.done:
			return fmt.Errorf("解析已取消")
		case <-time.After(120 * time.Millisecond):
		}
	}
}

// waitSession 等一个已存在的同直播间会话出结果
func (b *Browser) waitSession(s *browserSession) (string, error) {
	select {
	case <-s.done:
		rid, offline, _ := s.outcome()
		if offline {
			return "", douyin.ErrCaptchaOffline
		}
		if rid != "" {
			return rid, nil
		}
		return "", fmt.Errorf("浏览器未取到 roomId")
	case <-time.After(browserResolveTimeout):
		return "", fmt.Errorf("浏览器解析超时")
	}
}

func (b *Browser) doResolve(s *browserSession) (string, error) {
	if err := b.ensureWindow(); err != nil {
		return "", err
	}

	b.mu.Lock()
	createdAt := b.createdAt
	b.mu.Unlock()
	if wait := 1500*time.Millisecond - time.Since(createdAt); wait > 0 {
		time.Sleep(wait)
	}

	log.Printf("[DouyinBrowser] 解析直播间 %s (浏览器会话%s)", s.webRID, passedLabel(b.isPassed()))

	// 导航到直播间页
	b.navigateTo(s.webRID)

	// 超时预算: 已放行时 12s 足够 (实测 1~2s)
	budget := 12 * time.Second
	if !b.isPassed() {
		budget = 8 * time.Second
	}

	timer := time.NewTimer(budget)
	defer timer.Stop()

	for {
		select {
		case <-s.done:
			rid, offline, _ := s.outcome()
			if offline {
				return "", douyin.ErrCaptchaOffline
			}
			if rid != "" {
				b.markPassed()
				return rid, nil
			}
			return "", fmt.Errorf("浏览器未取到 roomId")
		case <-timer.C:
			// 用户正在手动过验证码
			if s.isAwaitingUser() {
				timer.Reset(browserResolveTimeout)
				continue
			}
			// 全局有其它人机验证挑战正在进行 -> 等它结束再放弃这个直播间
			if b.gate != nil && b.gate.Held() {
				log.Printf("[DouyinBrowser] 直播间 %s 等待其它验证码挑战结束后再继续", s.webRID)
				timer.Reset(browserResolveTimeout)
				continue
			}
			s.abort()
			return "", fmt.Errorf("浏览器解析超时")
		}
	}
}

// navigateTo 让常驻浏览器跳到指定直播间页
func (b *Browser) navigateTo(webRID string) {
	b.mu.Lock()
	win := b.win
	b.mu.Unlock()
	if win == nil {
		return
	}
	html := `<!doctype html><html><head><meta charset="utf-8"></head><body><script>location.replace("https://live.douyin.com/` + webRID + `");</script></body></html>`
	win.SetURL("data:text/html;base64," + base64.StdEncoding.EncodeToString([]byte(html)))
}

// ensureWindow 懒创建隐藏的常驻窗口
func (b *Browser) ensureWindow() error {
	b.mu.Lock()
	if b.ready && b.win != nil {
		b.mu.Unlock()
		return nil
	}
	if b.closed {
		b.mu.Unlock()
		return fmt.Errorf("常驻浏览器会话已关闭")
	}
	theme := b.theme
	b.mu.Unlock()

	var win *application.WebviewWindow
	win = b.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:        "douyin-browser",
		Title:       "抖音人机验证",
		Width:       520,
		Height:      640,
		HTML:        browserShellHTML(),
		JS:          muteMediaJS() + browserChromeJS(theme) + browserExtractJS(),
		Frameless:   true,
		AlwaysOnTop: true,
		KeyBindings: map[string]func(window application.Window){
			"escape": func(application.Window) {
				win.Close()
			},
		},
	})

	b.mu.Lock()
	b.win = win
	b.ready = true
	b.createdAt = time.Now()
	b.mu.Unlock()

	win.Hide()

	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		b.mu.Lock()
		b.ready = false
		b.win = nil
		b.passed = false
		sessions := make([]*browserSession, 0, len(b.sessions))
		for _, sess := range b.sessions {
			sessions = append(sessions, sess)
		}
		b.mu.Unlock()

		for _, sess := range sessions {
			sess.abort()
		}
	})

	log.Printf("[DouyinBrowser] 常驻浏览器会话已创建")
	return nil
}

// Close 销毁常驻浏览器窗口
func (b *Browser) Close() {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	win := b.win
	b.win = nil
	b.ready = false
	b.passed = false
	b.passedAt = time.Time{}
	b.active = ""
	// 收集所有排队中的会话，逐一 abort。
	sessions := make([]*browserSession, 0, len(b.sessions))
	for _, sess := range b.sessions {
		sessions = append(sessions, sess)
	}
	b.sessions = make(map[string]*browserSession)
	b.mu.Unlock()

	for _, sess := range sessions {
		sess.abort()
	}

	if win != nil {
		// 先 Hide 再 Close, 避免用户看到窗口"闪一下"再消失。
		win.Hide()
		win.Close()
		log.Printf("[DouyinBrowser] 常驻浏览器窗口已关闭")
	}
}

// handleMessage 处理常驻浏览器的注入脚本回传。
func (b *Browser) HandleMessage(message string) {
	const roomIDPrefix = "dtv:browser-roomid:"
	if strings.HasPrefix(message, roomIDPrefix) {
		rest := strings.TrimPrefix(message, roomIDPrefix)
		parts := strings.SplitN(rest, ":", 2)
		if len(parts) != 2 || parts[0] == "" {
			return
		}
		webRID, rid := parts[0], parts[1]
		b.mu.Lock()
		s := b.sessions[webRID]
		b.mu.Unlock()
		if s == nil {
			return
		}
		log.Printf("[DouyinBrowser] 直播间 %s 取到 roomId: %s", webRID, rid)
		s.finish(rid, false)
		return
	}

	const offlinePrefix = "dtv:browser-offline:"
	if strings.HasPrefix(message, offlinePrefix) {
		webRID := strings.TrimPrefix(message, offlinePrefix)
		b.mu.Lock()
		s := b.sessions[webRID]
		b.mu.Unlock()
		if s == nil {
			return
		}
		log.Printf("[DouyinBrowser] 直播间 %s 未开播 (页面无内嵌 roomId)", webRID)
		s.finish("", true)
		return
	}

	const captchaPrefix = "dtv:browser-captcha:"
	if strings.HasPrefix(message, captchaPrefix) {
		webRID := strings.TrimPrefix(message, captchaPrefix)
		b.mu.Lock()
		s := b.sessions[webRID]
		fallback := b.captchaFallback
		gate := b.gate
		b.mu.Unlock()
		if s == nil {
			return
		}
		if fallback != nil && b.beginFallback() {
			log.Printf("[DouyinBrowser] 直播间 %s 触发验证码，改用一次性验证码窗口", webRID)
			// 标记正在等用户手动通过验证码
			s.markAwaitingUser()
			b.releaseTurn(webRID)
			go func() {
				defer b.endFallback()
				release := func() {}
				if gate != nil {
					r, ok := gate.Challenge(webRID, captchaChallengeTimeout)
					if !ok {
						log.Printf("[DouyinBrowser] 直播间 %s 等待验证码闸门超时，放弃兜底弹窗", webRID)
						s.abort()
						return
					}
					release = r
				}

				b.notifyPending(true)
				defer b.notifyPending(false)
				defer release()

				rid, err := fallback(webRID)
				if err != nil || rid == "" {
					s.abort()
					return
				}
				s.finish(rid, false)
			}()
			return
		}
		log.Printf("[DouyinBrowser] 直播间 %s 触发验证码，等待验证码闸门", webRID)
		go func() {
			if gate == nil {
				return
			}
			release, ok := gate.Challenge(webRID, captchaChallengeTimeout)
			if !ok {
				log.Printf("[DouyinBrowser] 直播间 %s 等待验证码闸门超时，不再显示常驻窗口", webRID)
				s.abort()
				return
			}

			if s.isFinished() {
				release()
				return
			}
			b.notifyPending(true)
			defer b.notifyPending(false)
			defer release()

			b.mu.Lock()
			cur := b.win
			b.mu.Unlock()
			if cur == nil {
				s.abort()
				return
			}
			cur.Show()
			log.Printf("[DouyinBrowser] 直播间 %s 显示常驻窗口，请手动通过验证", webRID)
		}()
		return
	}
}

func passedLabel(passed bool) string {
	if passed {
		return "已放行"
	}
	return "未放行"
}

// browserShellHTML 常驻浏览器的初始页面
func browserShellHTML() string {
	return `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`
}

func browserChromeJS(mode string) string {
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
		`try{if(window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage){` +
		`window.chrome.webview.postMessage("dtv:browser-close");return;}}catch(e){}` +
		`try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.external){` +
		`window.webkit.messageHandlers.external.postMessage("dtv:browser-close");}}catch(e){}` +
		`});` +
		`document.body.appendChild(bar);` +
		`}catch(e){}}` +
		`function boot(){install();if(!done){setTimeout(boot,300);}}` +
		`boot();})();`
}

// browserExtractJS 常驻浏览器在抖音直播间页里执行的注入脚本
func browserExtractJS() string {
	return `(function(){` +
		`var reported=false;` +
		`var reportedCaptcha=false;` +
		`var offlineRounds=0;` +
		`var lastRID="";` +
		`function send(msg){` +
		`try{if(window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage){` +
		`window.chrome.webview.postMessage(msg);return true;}}catch(e){}` +
		`try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.external){` +
		`window.webkit.messageHandlers.external.postMessage(msg);return true;}}catch(e){}` +
		`return false;}` +
		`function currentRID(){` +
		`try{var loc=window.location?window.location.href:"";` +
		`var m=loc.match(/live\.douyin\.com\/(\d+)/);` +
		`return m?m[1]:"";}catch(e){return "";}}` +
		`function extract(){` +
		`try{` +
		`var h=document.documentElement?document.documentElement.outerHTML:"";` +
		`var m=h.match(/\\"roomId\\":\\"(\d{10,})\\"/);` +
		`if(!m)m=h.match(/"roomId":"(\d{10,})"/);` +
		`if(!m)m=h.match(/\\"room_id\\":\\"(\d{10,})\\"/);` +
		`if(!m){var ss=document.querySelectorAll("script");` +
		`for(var i=0;i<ss.length;i++){var t=ss[i].textContent||"";` +
		`m=t.match(/\\"roomId\\":\\"(\d{10,})\\"/)||t.match(/"roomId":"(\d{10,})"/);` +
		`if(m)break;}}` +
		`return m?m[1]:"";}catch(e){return "";}}` +
		`function isCaptchaPage(){` +
		`try{var h=document.documentElement?document.documentElement.outerHTML:"";` +
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
		`return false;}catch(e){return false;}}` +
		`function report(){` +
		`if(window.top!==window.self)return;` +
		`var rid=currentRID();` +
		`if(!rid){setTimeout(report,400);return;}` +
		`if(rid!==lastRID){lastRID=rid;reported=false;reportedCaptcha=false;offlineRounds=0;}` +
		`var room=extract();` +
		`if(room&&!reported){if(send("dtv:browser-roomid:"+rid+":"+room)){reported=true;return;}}` +
		`if(!reportedCaptcha&&isCaptchaPage()){` +
		`reportedCaptcha=true;` +
		`send("dtv:browser-captcha:"+rid);` +
		`}else if(reportedCaptcha&&!isCaptchaPage()){` +
		`reportedCaptcha=false;offlineRounds=0;` +
		`}` +
		`if(!reported&&!reportedCaptcha&&!isCaptchaPage()){` +
		`offlineRounds++;` +
		`if(offlineRounds>=6){reported=true;send("dtv:browser-offline:"+rid);return;}}` +
		`setTimeout(report,600);}` +
		`report();})();`
}
