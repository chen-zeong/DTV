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

	mu    sync.Mutex
	win   *application.WebviewWindow // 常驻窗口 (懒创建)
	ready bool                       // 窗口是否已创建
	theme string

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
	// offline 表示页面正常加载但拿不到 roomId (未开播的政务/事业机构直播间)
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
func (s *browserSession) outcome() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.result, s.offline
}

// browserResolveTimeout 是单个直播间用浏览器解析的超时
const browserResolveTimeout = 40 * time.Second

// browserQueueTimeout 是排队等待浏览器空闲的最长时间
const browserQueueTimeout = 3 * time.Minute

func NewBrowser(app *application.App) *Browser {
	return &Browser{
		app:      app,
		theme:    "dark",
		sessions: make(map[string]*browserSession),
	}
}

func (b *Browser) SetGate(g *Gate) {
	b.mu.Lock()
	b.gate = g
	b.mu.Unlock()
}

// SetThemeMode 同步主题 (验证码窗口)
func (b *Browser) SetThemeMode(mode string) {
	switch mode = strings.ToLower(strings.TrimSpace(mode)); mode {
	case "dark", "light":
		b.mu.Lock()
		b.theme = mode
		b.mu.Unlock()
	}
}

// isPassed 当前是否处于放行状态
//
// 放行是设备级的，由 douyin 包统一保存 (常驻浏览器与一次性弹窗共用一份),
// 免得两处各记一份、TTL 又不一致。
func (b *Browser) isPassed() bool {
	return douyin.CaptchaRecentlyPassed()
}

func (b *Browser) markPassed() {
	douyin.MarkCaptchaPassed()
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
	deadline := time.Now().Add(browserQueueTimeout)
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
		rid, offline := s.outcome()
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

	state := "未放行"
	if b.isPassed() {
		state = "已放行"
	}
	log.Printf("[DouyinBrowser] 解析直播间 %s (浏览器会话%s)", s.webRID, state)

	// 导航到直播间页
	b.navigateTo(s.webRID)

	// 超时预算必须大于注入脚本的离线判定时间，
	// 否则脚本还没下结论 Go 先超时
	budget := 20 * time.Second
	if !b.isPassed() {
		budget = 16 * time.Second
	}

	timer := time.NewTimer(budget)
	defer timer.Stop()

	for {
		select {
		case <-s.done:
			rid, offline := s.outcome()
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
		Width:       captchaWindowWidth,
		Height:      captchaWindowHeight,
		HTML:        browserShellHTML(),
		JS:          muteMediaJS() + chromeJS(theme, "dtv:browser-close") + browserExtractJS(),
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
		sessions := make([]*browserSession, 0, len(b.sessions))
		for _, sess := range b.sessions {
			sessions = append(sessions, sess)
		}
		b.mu.Unlock()

		// 窗口没了，放行 cookie 也随之失效
		douyin.ResetCaptchaPassed()

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
	b.active = ""
	// 收集所有排队中的会话，逐一 abort。
	sessions := make([]*browserSession, 0, len(b.sessions))
	for _, sess := range b.sessions {
		sessions = append(sessions, sess)
	}
	b.sessions = make(map[string]*browserSession)
	b.mu.Unlock()

	// 窗口没了，放行 cookie 也随之失效
	douyin.ResetCaptchaPassed()

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
					r, ok := gate.Challenge(captchaChallengeTimeout)
					if !ok {
						log.Printf("[DouyinBrowser] 直播间 %s 等待验证码闸门超时，放弃兜底弹窗", webRID)
						s.abort()
						return
					}
					release = r
				}

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
			release, ok := gate.Challenge(captchaChallengeTimeout)
			if !ok {
				log.Printf("[DouyinBrowser] 直播间 %s 等待验证码闸门超时，不再显示常驻窗口", webRID)
				s.abort()
				return
			}

			if s.isFinished() {
				release()
				return
			}
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

// browserShellHTML 常驻浏览器的初始页面
func browserShellHTML() string {
	return `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`
}

// browserExtractJS 常驻浏览器在抖音直播间页里执行的注入脚本
func browserExtractJS() string {
	return `(function(){` +
		`var reported=false;` +
		`var reportedCaptcha=false;` +
		`var loadRounds=0;` +
		`var liveRounds=0;` +
		`var idleRounds=0;` +
		`var lastRID="";` +
		`var deadline=0;` +
		sendSnippet +
		`function currentRID(){` +
		`try{var loc=window.location?window.location.href:"";` +
		`var m=loc.match(/live\.douyin\.com\/([A-Za-z0-9._-]+)/);` +
		`return m?m[1]:"";}catch(e){return "";}}` +
		extractFn("") +
		captchaPageSnippet +
		liveSignSnippet +
		`function report(){` +
		`if(window.top!==window.self)return;` +
		`var rid=currentRID();` +
		`if(!rid){setTimeout(report,400);return;}` +
		`var now=Date.now();` +
		`if(rid!==lastRID){lastRID=rid;deadline=now+` + browserDeadlineMS + `;reported=false;reportedCaptcha=false;loadRounds=0;liveRounds=0;idleRounds=0;}` +
		`var h=document.documentElement?document.documentElement.outerHTML:"";` +
		`var room=extract(h);` +
		`if(room&&!reported){if(send("dtv:browser-roomid:"+rid+":"+room)){reported=true;return;}}` +
		`if(!reportedCaptcha&&isCaptchaPage(h)){` +
		`reportedCaptcha=true;` +
		`send("dtv:browser-captcha:"+rid);` +
		`}else if(reportedCaptcha&&!isCaptchaPage(h)){` +
		`reportedCaptcha=false;loadRounds=0;liveRounds=0;idleRounds=0;` +
		`}` +
		`if(!reported&&!reportedCaptcha&&!isCaptchaPage(h)){` +
		phaseCountingJS(`"dtv:browser-offline:"+rid`, browserRounds) +
		`}` +
		`setTimeout(report,` + reportIntervalMS + `);}` +
		`report();})();`
}
