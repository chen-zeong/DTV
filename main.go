// DTV — 直播聚合客户端（Wails v3 版）
//
// 当前阶段：斗鱼 / 虎牙 / 抖音 / B 站 四个平台都已全量接入
// （分区、列表、房间、搜索、取流、弹幕全部走真实后端）。
package main

import (
	"embed"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"dtv/internal/appdirs"
	"dtv/internal/logging"
	"dtv/internal/platforms/douyu"
	"dtv/internal/services"
)

//go:embed all:frontend/dist
var assets embed.FS

/* ------------------------------------------------------------------ 窗口记忆 */

type windowState struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximised bool `json:"maximised"`
}

const (
	defaultWindowWidth  = 1440
	defaultWindowHeight = 810
	minWindowWidth      = 900
	minWindowHeight     = 600
)

func windowStatePath() string {
	return filepath.Join(appdirs.Ensure(appdirs.ConfigDir()), "window.json")
}

// validWindowBounds 过滤最小化窗口的哨兵坐标（Windows 常见 -18285/-32000）
// 以及明显异常的尺寸，避免把无效 bounds 写进 window.json。
func validWindowBounds(x, y, width, height int) bool {
	if x <= -10000 || y <= -10000 || x > 100000 || y > 100000 {
		return false
	}
	return width >= minWindowWidth && height >= minWindowHeight
}

func loadWindowState() (windowState, bool) {
	raw, err := os.ReadFile(windowStatePath())
	if err != nil {
		return windowState{}, false
	}
	var state windowState
	if err := json.Unmarshal(raw, &state); err != nil {
		return windowState{}, false
	}
	if state.Width < minWindowWidth || state.Height < minWindowHeight {
		return windowState{}, false
	}
	return state, true
}

func saveWindowState(state windowState) {
	path := windowStatePath()
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

/* ---------------------------------------------------------------------- 入口 */

func main() {
	closeLog := logging.Setup()
	defer closeLog()

	state, hasState := loadWindowState()

	var mainWindow *application.WebviewWindow
	var saveMu sync.Mutex

	app := application.New(application.Options{
		Name:        "DTV",
		Description: "DTV — 直播聚合客户端",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		// R-09：WebView2 缓存写到本机目录，不再进入漫游配置。
		Windows: application.WindowsOptions{
			WebviewUserDataPath: appdirs.Ensure(appdirs.WebView2Dir()),
		},
		// U-10：第二次启动只聚焦已有窗口，不再开第二份应用。
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.dtv.app",
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
				if mainWindow != nil {
					mainWindow.Restore()
					mainWindow.Focus()
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// 崩溃时保留堆栈，方便定位平台接口解析问题（同时写入日志文件）
		PanicHandler: func(details *application.PanicDetails) {
			slog.Error("应用崩溃", "error", details.Error, "stack", details.StackTrace)
		},
	})

	// --- 窗口尺寸/位置：恢复上次状态并做屏幕边界校正 -------------------------
	width := defaultWindowWidth
	height := defaultWindowHeight
	position := application.WindowCentered
	x, y := 0, 0
	maximised := false

	if hasState {
		width, height = state.Width, state.Height
		maximised = state.Maximised
	}
	// 旧版本可能把最小化时的 -18285 坐标写进文件；这种坐标只用于居中，
	// 不要拿去摆放窗口。尺寸仍然沿用。
	hasValidPosition := hasState && validWindowBounds(state.X, state.Y, width, height)
	if screen := app.Screen.GetPrimary(); screen != nil {
		if screen.WorkArea.Width > 0 && width > screen.WorkArea.Width {
			width = screen.WorkArea.Width
		}
		if screen.WorkArea.Height > 0 && height > screen.WorkArea.Height {
			height = screen.WorkArea.Height
		}
		if hasValidPosition {
			// 只要窗口和任意屏幕有交集就沿用上次坐标，否则回到居中。
			visible := false
			for _, candidate := range app.Screen.GetAll() {
				if candidate == nil {
					continue
				}
				area := candidate.WorkArea
				if state.X < area.X+area.Width-80 &&
					state.X+width > area.X+80 &&
					state.Y < area.Y+area.Height-80 &&
					state.Y+height > area.Y+40 {
					visible = true
					break
				}
			}
			if visible {
				position = application.WindowXY
				x, y = state.X, state.Y
			}
		}
	}

	// 斗鱼 Service 必须在 app 创建之后注册：它的弹幕回调要把事件发到
	// app.Event 总线上，而总线是 app 的成员。
	emit := func(name string, payload any) {
		app.Event.Emit(name, payload)
	}
	// 斗鱼 Client 由服务与直播流中继共用：登录 Cookie / did / 加密描述符
	// 必须一致，否则中继会用另一份客户端按游客档位重新取流。
	douyuClient := douyu.NewClient()

	app.RegisterService(application.NewService(services.NewDouyuService(emit, douyuClient)))
	app.RegisterService(application.NewService(services.NewHuyaService(emit)))
	app.RegisterService(application.NewService(services.NewDouyinService(emit)))
	app.RegisterService(application.NewService(services.NewBilibiliService(emit)))

	// 直播流中继：斗鱼直链 300 秒后会被 CDN 断开，由它在到期前续流。
	app.RegisterService(application.NewService(services.NewStreamRelayService(douyuClient)))

	// 本地能力：图片代理 + 局域网数据同步。
	// 图片代理由前端在首屏渲染后调用 EnsureStarted 启动；
	// 局域网共享则由用户在顶栏的“数据同步”弹窗里手动开启。
	app.RegisterService(application.NewService(services.NewImageProxyService()))
	app.RegisterService(application.NewService(services.NewLanSyncService()))
	// 配置文件导入 / 导出：只负责系统文件对话框与磁盘读写。
	app.RegisterService(application.NewService(services.NewDataTransferService()))

	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "DTV",
		// 默认与 Tauri 版一致：1440×810；有历史状态时恢复上次尺寸/位置。
		Width:           width,
		Height:          height,
		InitialPosition: position,
		X:               x,
		Y:               y,
		MinWidth:        minWindowWidth,
		MinHeight:       minWindowHeight,
		// 与 Tauri 版一致：无系统标题栏，标题栏由前端 Navbar 自绘
		// （前端通过 CSS `--wails-draggable: drag` 提供拖拽区域）
		Frameless:     true,
		DisableResize: false,
		// 首帧背景色与暗色主题 --bg-primary 对齐，避免启动白闪
		BackgroundColour: application.NewRGB(0x0a, 0x0b, 0x0d),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 72,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		Windows: application.WindowsWindow{
			// ---------------------------------------------------------------
			// 关于"用系统按钮但保持无边框"
			//
			// Wails v3 没有"隐藏标题栏但仍由系统绘制最小化/最大化/关闭"的开关：
			// Frameless 会连整条非客户区一起去掉，系统按钮不会单独保留。
			// 官方给出的等价方案是 **WebView2 合成器托管 + 非客户区命中测试**：
			// 窗口依旧无边框，前端自绘的按钮被注册成真正的
			// HTMINBUTTON / HTMAXBUTTON / HTCLOSE 区域，于是拥有系统按钮的行为
			// （原生 hover/按下/捕获，最大化按钮还会弹出 Win11 贴靠布局面板）。
			// 前端标记在 WindowControls.module.css 的 `--wails-non-client-region`。
			//
			// 但它是实验特性，且**在本机实测不可用**：开启后 WebView2 创建
			// 合成器控制器返回 800700aa（ERROR_BUSY），Wails 回退 HWND 控制器时
			// 同样失败，应用直接崩溃退出。所以这里默认关闭。
			//
			// 想试它的效果时把下面这行改成 true 重新构建即可；若你的 WebView2
			// 运行时版本支持，三个按钮就会变成原生行为，视觉不变。
			// 关掉时前端按钮完全走 JS（lib/window.ts），功能不受影响。
			// ---------------------------------------------------------------
			WebView2CompositionHosting: false,
			// 保留无边框窗口自带的 Aero 阴影 / 圆角
			DisableFramelessWindowDecorations: false,
		},
		URL: "/",
	})

	// --- 窗口状态持久化 -----------------------------------------------------
	// resize/move 时先抓一份普通窗口 bounds，再防抖写盘。这样用户“拖完立刻
	// 最小化/关闭”也不会丢掉刚调整的尺寸。
	captureNormalBounds := func() {
		if mainWindow == nil || mainWindow.IsMinimised() || mainWindow.IsMaximised() {
			return
		}
		x, y := mainWindow.Position()
		width, height := mainWindow.Size()
		if !validWindowBounds(x, y, width, height) {
			return
		}
		saveMu.Lock()
		state = windowState{X: x, Y: y, Width: width, Height: height}
		saveMu.Unlock()
	}

	persist := func() {
		saveMu.Lock()
		defer saveMu.Unlock()
		if mainWindow == nil {
			return
		}

		// 最小化时 Windows 会给出 -18285/-32000 之类的哨兵坐标，不能读。
		// 直接保存最后一次捕获到的普通窗口 bounds。
		if mainWindow.IsMinimised() {
			if validWindowBounds(state.X, state.Y, state.Width, state.Height) {
				saveWindowState(state)
			}
			return
		}

		isMax := mainWindow.IsMaximised()
		next := windowState{Maximised: isMax}
		if isMax {
			// 最大化时 Size/Position 是屏幕尺寸；保留上一次的普通窗口 bounds。
			next.X, next.Y = state.X, state.Y
			next.Width, next.Height = state.Width, state.Height
			if !validWindowBounds(next.X, next.Y, next.Width, next.Height) {
				next.X, next.Y = 0, 0
				next.Width, next.Height = defaultWindowWidth, defaultWindowHeight
			}
		} else {
			x, y := mainWindow.Position()
			width, height := mainWindow.Size()
			if !validWindowBounds(x, y, width, height) {
				return
			}
			next.X, next.Y = x, y
			next.Width, next.Height = width, height
			state = next
		}
		saveWindowState(next)
	}

	var persistTimer *time.Timer
	schedulePersist := func() {
		saveMu.Lock()
		if persistTimer != nil {
			persistTimer.Stop()
		}
		persistTimer = time.AfterFunc(400*time.Millisecond, persist)
		saveMu.Unlock()
	}

	mainWindow.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) {
		captureNormalBounds()
		schedulePersist()
	})
	mainWindow.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		captureNormalBounds()
		schedulePersist()
	})
	mainWindow.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		if persistTimer != nil {
			persistTimer.Stop()
		}
		persist()
	})

	if maximised {
		mainWindow.Maximise()
	}

	slog.Info("DTV 启动", "config", appdirs.ConfigDir())

	if err := app.Run(); err != nil {
		slog.Error("应用退出", "error", err)
	}
}
