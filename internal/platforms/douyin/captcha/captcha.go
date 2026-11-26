// Package captcha 是抖音直播间的验证码 / 风控拦截处理。
//
// 它包含两条互补的取内部 roomId 路径:
//   - Captcha: 一次性弹窗式验证码窗口 (用户手动过验证码);
//   - Browser: 常驻隐藏 WebView 的"浏览器会话" (设备/IP 级放行后静默解析)
package captcha

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"dtv/internal/platforms/douyin"
)

// Captcha 解决抖音直播间页的验证码拦截
type Captcha struct {
	app *application.App

	mu        sync.Mutex
	current   *captchaSession // 当前进行中的验证码会话 (nil = 没有弹窗)
	themeMode string          // 当前主题明暗模式 (dark / light) ，由前端 ThemeProvider 同步

	// browser 是常驻浏览器会话
	browser *Browser

	// 保证同一时刻屏幕上最多只有一个验证码弹窗
	gate *Gate
}

// captchaSession 一次验证码会话
type captchaSession struct {
	webRID  string
	win     *application.WebviewWindow
	done    chan struct{} // 关闭 = 窗口被取消 (Esc/手动关)
	results chan string   // roomId 回传 (放大缓冲，防广播竞态)
	show    chan struct{} // 注入脚本报告「验证码页」→ 请求显示窗口 (缓冲 1)
	mu      sync.Mutex
	closed  bool // 是否已结束

	gateHeld bool
}

// isClosed 返回会话是否已结束
func (s *captchaSession) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func New(app *application.App) *Captcha {
	return &Captcha{app: app, themeMode: "dark", gate: NewGate()}
}

// SetBrowser 关联常驻浏览器会话，用于静默解析
func (d *Captcha) SetBrowser(b *Browser) {
	d.mu.Lock()
	d.browser = b
	d.mu.Unlock()
}

// captchaFallbackDelay 是注入脚本没发「验证码页」信号时的兜底显示延迟。
//
// 正常情况由脚本的 dtv:captcha-page 信号触发显示；这个超时只是防信号丢失。
const captchaFallbackDelay = 12 * time.Second

// Resolve 实现 douyin.CaptchaResolver
//
// 并发行为:
//   - 同一直播间: 复用同一个会话窗口，roomId 到达时一起拿到 (避免重复弹窗) ；
//   - 不同直播间: 等待当前会话结束后，常驻浏览器队列里等真正结果
func (d *Captcha) Resolve(webRID string) (string, error) {
	if d.browser != nil && !d.browser.inFallbackMode() {
		if rid, ok := d.browser.resolveFast(webRID, 5*time.Second); ok {
			log.Printf("[DouyinCaptcha] 直播间 %s 由常驻浏览器会话解析成功 (未弹窗) ", webRID)
			return rid, nil
		}
	}

	d.mu.Lock()
	if s := d.current; s != nil {
		d.mu.Unlock()
		if s.webRID == webRID {
			return d.wait(s)
		}
		// 等占用会话结束 (上限 3min，与会话自身超时一致)
		select {
		case <-s.done:
		case <-time.After(3 * time.Minute):
		}
		// 队列腾出后进常驻浏览器队列等真正结果
		// Browser.Resolve 内部 waitTurn 会排队 (上限 3min) 并解析出 roomId
		if d.browser != nil && !d.browser.inFallbackMode() {
			rid, err := d.browser.Resolve(webRID)
			if err == nil && rid != "" {
				log.Printf("[DouyinCaptcha] 直播间 %s 由常驻浏览器队列解析成功 ", webRID)
				return rid, nil
			}
			if errors.Is(err, douyin.ErrCaptchaOffline) {
				return "", douyin.ErrCaptchaOffline
			}
			log.Printf("[DouyinCaptcha] 直播间 %s 常驻浏览器队列解析失败: %v", webRID, err)
		}
		log.Printf("[DouyinCaptcha] 直播间 %s 等待其它会话结束失败 ", webRID)
		return "", fmt.Errorf("等待其它验证码会话结束")
	}
	// 新会话
	//
	// 确保同一时刻只有一个一次性验证码会话存在
	//
	// 例外: 常驻浏览器进行验证码弹窗时，它已经提前占住了 gate。这种情况
	// 下不能再去申请 gate，用 gateHeld 标记
	gateHeld := d.browser != nil && d.browser.inFallbackMode()
	s := &captchaSession{
		webRID:   webRID,
		done:     make(chan struct{}),
		results:  make(chan string, 4),
		show:     make(chan struct{}, 1),
		gateHeld: gateHeld,
	}
	d.current = s
	d.mu.Unlock()

	d.openWindow(s)
	defer d.finishSession(s)

	return d.wait(s)
}

// offlineSentinel 是注入脚本报告时投递给等待者的值
const offlineSentinel = "0"

// wait 等待 roomId / 取消 / 超时。
func (d *Captcha) wait(s *captchaSession) (string, error) {
	timeout := time.After(3 * time.Minute)
	select {
	case rid := <-s.results:
		if rid == offlineSentinel {
			// 未开播直播间: 脚本确认页面正常但没有 roomId，立即返回
			return "", douyin.ErrCaptchaOffline
		}
		if rid != "" {
			return rid, nil
		}
		return "", fmt.Errorf("验证码回传了空 roomId")
	case <-s.done:
		return "", fmt.Errorf("用户取消了验证码")
	case <-timeout:
		return "", fmt.Errorf("验证码等待超时")
	}
}

func (d *Captcha) finishSession(s *captchaSession) {
	d.mu.Lock()
	if d.current == s {
		d.current = nil
	}
	d.mu.Unlock()

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	// 广播取消 (等待者若还没拿到结果，从 done 通道退出)
	select {
	case <-s.done:
	default:
		close(s.done)
	}

	if s.win != nil {
		// 关闭前先导航到空白页，让正在加载的抖音页停止渲染
		s.win.SetURL("about:blank")
		s.win.Hide()
		s.win.Close()
		log.Printf("[DouyinCaptcha] 直播间 %s 验证码窗口已关闭", s.webRID)
	}
}

// Close 销毁可能存在的验证码窗口
func (d *Captcha) Close() {
	d.mu.Lock()
	s := d.current
	d.current = nil
	d.mu.Unlock()

	if s == nil {
		return
	}
	d.finishSession(s)
	log.Printf("[DouyinCaptcha] 验证码窗口已随应用关闭")
}

// openWindow 弹出验证码窗口
func (d *Captcha) openWindow(s *captchaSession) {
	d.mu.Lock()
	mode := d.themeMode
	d.mu.Unlock()

	var win *application.WebviewWindow
	win = d.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:  "douyin-captcha-" + s.webRID,
		Title: "抖音人机验证",
		// 抖音验证码卡片约 470×510，加上标题栏 46px 与两侧余量
		Width:       captchaWindowWidth,
		Height:      captchaWindowHeight,
		HTML:        redirectHTML(s.webRID),
		JS:          muteMediaJS() + chromeJS(mode, "dtv:cancel:"+s.webRID) + extractJS(s.webRID),
		Frameless:   true,
		AlwaysOnTop: true,
		// Esc 真正关闭验证码窗口 (HideOnEscape 只隐藏不销毁)
		KeyBindings: map[string]func(window application.Window){
			"escape": func(application.Window) {
				win.Close()
			},
		},
	})

	s.win = win

	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		// 用户手动关闭窗口 (Esc / 任务栏)，结束会话、广播取消
		go d.finishSession(s)
	})

	win.Hide()
	go func() {
		timer := time.NewTimer(captchaFallbackDelay)
		defer timer.Stop()
		select {
		case <-s.done:
			// 已拿到 roomId / 用户已取消: 窗口永不显示。
			return
		case <-s.show:
			// 需要用户手动过验证码。
		case <-timer.C:
			// 脚本通知丢失时，超时才显示窗口。
		}

		release := func() {}
		if !s.gateHeld {
			r, ok := d.gate.Challenge(captchaChallengeTimeout)
			if !ok {
				log.Printf("[DouyinCaptcha] 直播间 %s 等待验证码gate超时，不再显示窗口", s.webRID)
				go d.finishSession(s)
				return
			}
			release = r
		}

		if s.isClosed() {
			release()
			return
		}

		defer release()

		win.Show()
		log.Printf("[DouyinCaptcha] 直播间 %s 显示验证码窗口，等待用户完成挑战", s.webRID)
	}()
	log.Printf("[DouyinCaptcha] 直播间 %s 触发验证码，等待自动放行或弹窗 (主题: %s)", s.webRID, mode)
}

// captchaChallengeTimeout 是等待验证码 gate 的时间上限
const captchaChallengeTimeout = 30 * time.Second

// Pending 当前是否有人机验证挑战正在进行，或在排队等待
func (d *Captcha) Pending() bool {
	return d.gate.Pending()
}

// SetPendingCallback 注册挑战状态变化回调
func (d *Captcha) SetPendingCallback(cb func(pending bool)) {
	d.gate.SetPendingCallback(cb)
}

// Gate 返回全局挑战 gate 供常驻浏览器会话共用
func (d *Captcha) Gate() *Gate {
	return d.gate
}

// EventCaptchaPending 人机验证挑战状态变化事件名
const EventCaptchaPending = "douyin-captcha-pending"

// SetThemeMode 由前端 ThemeProvider 在主题切换时调用，同步当前明暗模式
func (d *Captcha) SetThemeMode(mode string) error {
	switch mode = strings.ToLower(strings.TrimSpace(mode)); mode {
	case "dark", "light":
		d.mu.Lock()
		d.themeMode = mode
		d.mu.Unlock()
	default:
		// 未知值忽略，保持现状
	}
	return nil
}

// redirectHTML 中转页: 立即跳转到抖音直播间页
//
// 中转页的作用是让 WebviewWindowOptions.HTML 非空，
// 从而触发 options.JS 的注入路径
func redirectHTML(webRID string) string {
	return `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
		`<script>location.replace("https://live.douyin.com/` + webRID + `");</script>` +
		`</body></html>`
}

// extractJS 在抖音直播间页里执行的注入脚本（一次性验证码窗口用）
//
// 差异点：直播间号从 URL 里按已知 webRID 匹配；未开播判定 5 轮。
func extractJS(webRID string) string {
	return `(function(){` +
		`var reported=false;` +
		`var reportedCaptcha=false;` +
		`var loadRounds=0;` +
		`var liveRounds=0;` +
		`var idleRounds=0;` +
		`var deadline=0;` +
		sendSnippet +
		`function isRoomPage(){` +
		`try{var loc=window.location?window.location.href:"";` +
		`return loc.indexOf("/` + webRID + `")>=0;}catch(e){return false;}}` +
		extractFn(`if(!isRoomPage()){return "";}`) +
		captchaPageSnippet +
		liveSignSnippet +
		`function report(){` +
		`if(window.top!==window.self)return;` +
		`if(!isRoomPage()){setTimeout(report,` + reportIntervalMS + `);return;}` +
		`var now=Date.now();` +
		`if(!deadline)deadline=now+` + popupDeadlineMS + `;` +
		`var h=document.documentElement?document.documentElement.outerHTML:"";` +
		`if(!reportedCaptcha&&isCaptchaPage(h)){` +
		`reportedCaptcha=true;` +
		`if(send("dtv:captcha-page:` + webRID + `")){/* 已通知显示窗口，继续等 roomId */}}` +
		`var rid=extract(h);` +
		`if(rid&&!reported){if(send("dtv:roomid:` + webRID + `:"+rid)){reported=true;return;}}` +
		`if(reportedCaptcha){` +
		`if(!isCaptchaPage(h)){` +
		`deadline=now+` + popupDeadlineMS + `;reportedCaptcha=false;loadRounds=0;liveRounds=0;idleRounds=0;}` +
		`setTimeout(report,` + reportIntervalMS + `);return;}` +
		`if(!isCaptchaPage(h)){` +
		phaseCountingJS(`"dtv:offline:`+webRID+`"`, popupRounds) +
		`}` +
		`setTimeout(report,` + reportIntervalMS + `);}` +
		`report();})();`
}

// handleMessage 处理注入脚本回传的消息
//
// 消息格式:
//   - dtv:roomid:<webRID>:<internalRoomID>  已放行，回传内部 roomId
//   - dtv:captcha-page:<webRID>             页面仍是验证码中间页，请求显示窗口
//   - dtv:offline:<webRID>                  未开播/蓝V直播间页面内嵌 JSON 无 roomId
//   - dtv:cancel:<webRID>                   用户点了外壳上的关闭按钮
func (d *Captcha) HandleMessage(_ application.Window, message string, _ *application.OriginInfo) {
	const cancelPrefix = "dtv:cancel:"
	if strings.HasPrefix(message, cancelPrefix) {
		webRID := strings.TrimPrefix(message, cancelPrefix)
		d.mu.Lock()
		s := d.current
		d.mu.Unlock()
		if s != nil && s.webRID == webRID {
			log.Printf("[DouyinCaptcha] 直播间 %s 用户关闭验证码弹窗", webRID)
			go d.finishSession(s)
		}
		return
	}

	const captchaPagePrefix = "dtv:captcha-page:"
	if strings.HasPrefix(message, captchaPagePrefix) {
		webRID := strings.TrimPrefix(message, captchaPagePrefix)
		d.mu.Lock()
		s := d.current
		d.mu.Unlock()
		if s == nil || s.webRID != webRID {
			return
		}
		select {
		case s.show <- struct{}{}:
		default:
			// 已通知过，忽略重复
		}
		return
	}

	const offlinePrefix = "dtv:offline:"
	if strings.HasPrefix(message, offlinePrefix) {
		webRID := strings.TrimPrefix(message, offlinePrefix)
		d.mu.Lock()
		s := d.current
		d.mu.Unlock()
		if s == nil || s.webRID != webRID {
			return
		}
		log.Printf("[DouyinCaptcha] 直播间 %s 未开播 (页面无内嵌 roomId), 结束验证码会话", webRID)
		select {
		case s.results <- offlineSentinel:
		default:
		}
		go d.finishSession(s)
		return
	}

	const prefix = "dtv:roomid:"
	if !strings.HasPrefix(message, prefix) {
		return
	}
	rest := strings.TrimPrefix(message, prefix)
	parts := strings.SplitN(rest, ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return
	}
	webRID, rid := parts[0], parts[1]

	d.mu.Lock()
	s := d.current
	d.mu.Unlock()
	if s == nil || s.webRID != webRID {
		log.Printf("[DouyinCaptcha] 收到 roomId 但没有匹配的会话 webRID=%s rid=%s", webRID, rid)
		return
	}

	log.Printf("[DouyinCaptcha] 直播间 %s 验证码通过，roomId: %s", webRID, rid)

	select {
	case s.results <- rid:
	default:
	}
	go d.finishSession(s)
}

// CaptchaService 是验证码能力的 Wails IPC 边界
type CaptchaService struct {
	inner   *Captcha
	browser *Browser
}

// NewCaptchaService 创建验证码 IPC 边界
func NewCaptchaService(inner *Captcha, browser *Browser) *CaptchaService {
	return &CaptchaService{inner: inner, browser: browser}
}

// SetThemeMode 由前端 ThemeProvider 调用，同步当前明暗模式 (dark/light) ，
// 让验证码弹窗外壳跟随主窗口主题。
func (s *CaptchaService) SetThemeMode(mode string) error {
	if err := s.inner.SetThemeMode(mode); err != nil {
		return err
	}
	if s.browser != nil {
		s.browser.SetThemeMode(mode)
	}
	return nil
}

// IsPending 当前是否有人机验证挑战正在进行，或有人在排队等待
func (s *CaptchaService) IsPending() bool {
	return s.inner.Pending()
}
