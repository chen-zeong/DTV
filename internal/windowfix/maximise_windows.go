//go:build windows

package windowfix

import (
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

const (
	wmNCCalcSize       uintptr = 0x0083
	abmGetAutoHideBarEx uintptr = 0x0000000b
	absAutohide        uintptr = 0x00000001

	swpNoSize       uint = 0x0001
	swpNoMove       uint = 0x0002
	swpNoZOrder     uint = 0x0004
	swpNoActivate   uint = 0x0010
	swpFrameChanged uint = 0x0020
)

var (
	modComctl32              = syscall.NewLazyDLL("comctl32.dll")
	procSetWindowSubclass    = modComctl32.NewProc("SetWindowSubclass")
	procDefSubclassProc      = modComctl32.NewProc("DefSubclassProc")
	procRemoveWindowSubclass = modComctl32.NewProc("RemoveWindowSubclass")

	modShell32          = syscall.NewLazyDLL("shell32.dll")
	procSHAppBarMessage = modShell32.NewProc("SHAppBarMessage")
)

// AttachMaximiseWorkAreaFix 修复无边框窗口在 Windows 最大化时盖满整屏导致
// 自动隐藏任务栏无法贴边弹出的问题（#184）。
//
// 成因：任务栏开启自动隐藏时，PhysicalWorkArea 与显示器整屏尺寸几乎一致。
// Wails v3 在 WM_NCCALCSIZE 中将最大化客户区设为 PhysicalWorkArea，
// 使客户区严丝合缝覆盖整个显示器，Windows Shell 的 SHQueryUserNotificationState()
// 因此返回 QUNS_BUSY (2)，进而压制自动隐藏任务栏的贴边唤醒。
//
// 解法：拦截 WM_NCCALCSIZE，在最大化（非全屏）状态下，针对存在自动隐藏任务栏的
// 边缘或客户区仍等于整屏时向内缩 1px，既保持肉眼无感的贴边效果，又解除 QUNS_BUSY。
func AttachMaximiseWorkAreaFix(win *application.WebviewWindow) {
	if win == nil {
		return
	}

	var attached atomic.Bool
	var isFullscreen atomic.Bool

	win.OnWindowEvent(events.Common.WindowFullscreen, func(*application.WindowEvent) {
		isFullscreen.Store(true)
	})
	win.OnWindowEvent(events.Common.WindowUnFullscreen, func(*application.WindowEvent) {
		isFullscreen.Store(false)
	})
	win.OnWindowEvent(events.Windows.WindowFullscreen, func(*application.WindowEvent) {
		isFullscreen.Store(true)
	})
	win.OnWindowEvent(events.Windows.WindowUnFullscreen, func(*application.WindowEvent) {
		isFullscreen.Store(false)
	})

	var subclassProc uintptr
	subclassProc = syscall.NewCallback(func(hwnd, msg, wparam, lparam, idSubclass, dwRefData uintptr) uintptr {
		if msg == 0x0082 { // WM_NCDESTROY
			_, _, _ = procRemoveWindowSubclass.Call(hwnd, subclassProc, idSubclass)
			return defSubclassProc(hwnd, msg, wparam, lparam)
		}

		ret := defSubclassProc(hwnd, msg, wparam, lparam)

		if msg == wmNCCalcSize && wparam != 0 && !isFullscreen.Load() && w32.IsZoomed(w32.HWND(hwnd)) {
			rgrc := (*w32.RECT)(unsafe.Pointer(lparam))
			monitor := w32.MonitorFromWindow(w32.HWND(hwnd), w32.MONITOR_DEFAULTTONEAREST)
			var mi w32.MONITORINFO
			mi.CbSize = uint32(unsafe.Sizeof(mi))
			if monitor != 0 && w32.GetMonitorInfo(monitor, &mi) {
				edges := detectAutoHideEdges(mi.RcMonitor)
				AdjustMaximisedClientRect(rgrc, mi.RcMonitor, edges)
			}
		}

		return ret
	})

	attach := func() {
		if attached.Load() {
			return
		}
		application.InvokeSync(func() {
			hwnd := uintptr(win.NativeWindow())
			if hwnd == 0 || !attached.CompareAndSwap(false, true) {
				return
			}
			_, _, _ = procSetWindowSubclass.Call(hwnd, subclassProc, 1, 0)
			if w32.IsZoomed(w32.HWND(hwnd)) {
				w32.SetWindowPos(
					w32.HWND(hwnd),
					0,
					0, 0, 0, 0,
					swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged,
				)
			}
		})
	}

	win.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) {
		attach()
	})
	win.OnWindowEvent(events.Common.WindowMaximise, func(*application.WindowEvent) {
		attach()
	})
	win.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		attach()
	})
}

func defSubclassProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	ret, _, _ := procDefSubclassProc.Call(hwnd, msg, wparam, lparam)
	return ret
}

func detectAutoHideEdges(monitorRect w32.RECT) [4]bool {
	var edges [4]bool

	var stateData w32.APPBARDATA
	stateData.CbSize = uint32(unsafe.Sizeof(stateData))
	state, _, _ := procSHAppBarMessage.Call(w32.ABM_GETSTATE, uintptr(unsafe.Pointer(&stateData)))
	if state&absAutohide == 0 {
		return edges
	}

	for edge := uint32(w32.ABE_LEFT); edge <= w32.ABE_BOTTOM; edge++ {
		var abd w32.APPBARDATA
		abd.CbSize = uint32(unsafe.Sizeof(abd))
		abd.UEdge = edge
		abd.Rc = monitorRect
		bar, _, _ := procSHAppBarMessage.Call(abmGetAutoHideBarEx, uintptr(unsafe.Pointer(&abd)))
		if bar == 0 {
			bar, _, _ = procSHAppBarMessage.Call(w32.ABM_GETAUTOHIDEBAR, uintptr(unsafe.Pointer(&abd)))
		}
		edges[edge] = bar != 0
	}
	return edges
}

// AdjustMaximisedClientRect 在最大化且存在自动隐藏任务栏（或客户区完全盖满屏幕）时，
// 让客户区向内退让 1px，避免触发 Windows 全屏判定（QUNS_BUSY）并让任务栏能贴边唤出。
func AdjustMaximisedClientRect(client *w32.RECT, monitor w32.RECT, autohideEdges [4]bool) {
	if client == nil {
		return
	}
	if autohideEdges[w32.ABE_LEFT] && client.Left <= monitor.Left {
		client.Left = monitor.Left + 1
	}
	if autohideEdges[w32.ABE_TOP] && client.Top <= monitor.Top {
		client.Top = monitor.Top + 1
	}
	if autohideEdges[w32.ABE_RIGHT] && client.Right >= monitor.Right {
		client.Right = monitor.Right - 1
	}
	if autohideEdges[w32.ABE_BOTTOM] && client.Bottom >= monitor.Bottom {
		client.Bottom = monitor.Bottom - 1
	}

	// 兜底：只要客户区与显示器物理矩形完全重合，Windows 就会判成独占全屏 (QUNS_BUSY)。
	if *client == monitor && monitor.Right > monitor.Left+1 && monitor.Bottom > monitor.Top+1 {
		client.Right = monitor.Right - 1
		client.Bottom = monitor.Bottom - 1
	}
}
