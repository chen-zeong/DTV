// DTV — 直播聚合客户端（Wails v3 版）
//
// 当前阶段（P1/P2）：**只有前端**。Go 侧仅负责创建窗口与提供静态资源，
// 不注册任何 Service / 绑定；前端所有数据来自 src/mock 下的假数据。
// 后续接入后端时，在 application.Options.Services 中注册
// internal/services 里的 Service 即可，main.go 其余部分不需要改动。
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "DTV",
		Description: "DTV — 直播聚合客户端",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "DTV",
		// 与 Tauri 版一致：1440×810，居中
		Width:           1440,
		Height:          810,
		InitialPosition: application.WindowCentered,
		// 与 Tauri 版一致：无系统标题栏，标题栏由前端 Navbar 自绘
		// （前端通过 CSS `--wails-draggable: drag` 提供拖拽区域）
		Frameless:     true,
		DisableResize: false,
		// 首帧背景色与暗色主题 --bg-primary 对齐，避免启动白闪
		BackgroundColour: application.NewRGB(0x1a, 0x1a, 0x1a),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 72,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		URL: "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
