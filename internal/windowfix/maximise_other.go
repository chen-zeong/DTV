//go:build !windows

package windowfix

import "github.com/wailsapp/wails/v3/pkg/application"

// AttachMaximiseWorkAreaFix 非 Windows 平台无需调整最大化客户区。
func AttachMaximiseWorkAreaFix(*application.WebviewWindow) {}
