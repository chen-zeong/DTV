// Package appdirs 统一管理 DTV 在本机的目录布局。
package appdirs

import (
	"os"
	"path/filepath"
)

// ConfigDir 返回 %APPDATA%\DTV（窗口位置、用户配置等可漫游数据）。
func ConfigDir() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		base = "."
	}
	return filepath.Join(base, "DTV")
}

// LocalAppData 返回 %LOCALAPPDATA%\DTV（缓存、日志、WebView2 数据等本机数据）。
func LocalAppData() string {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = "."
	}
	return filepath.Join(base, "DTV")
}

// ImageCacheDir 返回图片代理的磁盘缓存目录。
func ImageCacheDir() string {
	return filepath.Join(LocalAppData(), "image-cache")
}

// LogsDir 返回日志目录。
func LogsDir() string {
	return filepath.Join(LocalAppData(), "logs")
}

// WebView2Dir 返回 WebView2 用户数据目录（避免写入漫游配置）。
func WebView2Dir() string {
	return filepath.Join(LocalAppData(), "WebView2")
}

// Ensure 创建目录（已存在时忽略）。
func Ensure(path string) string {
	_ = os.MkdirAll(path, 0o755)
	return path
}
