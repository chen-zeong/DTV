// Package logging 把 slog 输出同时写到文件与 stderr。
package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"dtv/internal/appdirs"
)

const maxLogBytes = 10 << 20 // 单文件 10MB，超出后滚动到 .1

type rotatingWriter struct {
	mu   sync.Mutex
	dir  string
	day  string
	file *os.File
	size int64
}

func newRotatingWriter(dir string) (*rotatingWriter, error) {
	w := &rotatingWriter{dir: dir}
	if err := w.open(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *rotatingWriter) open() error {
	w.day = time.Now().Format("20060102")
	path := filepath.Join(w.dir, "dtv-"+w.day+".log")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	info, _ := file.Stat()
	w.file = file
	if info != nil {
		w.size = info.Size()
	}
	return nil
}

func (w *rotatingWriter) rotate() {
	if w.file == nil {
		return
	}
	path := w.file.Name()
	_ = w.file.Close()
	_ = os.Rename(path, path+".1")
	w.file = nil
	w.size = 0
	_ = w.open()
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// 跨天或超过大小上限时滚动
	if w.file == nil || time.Now().Format("20060102") != w.day || w.size+int64(len(p)) > maxLogBytes {
		w.rotate()
	}
	if w.file == nil {
		return len(p), nil
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

// Setup 初始化全局 logger：文件 + stderr（便于 `wails3 dev` 时观察）。
// 返回的函数用于在退出时关闭文件。
func Setup() func() {
	dir := appdirs.Ensure(appdirs.LogsDir())
	writer, err := newRotatingWriter(dir)
	if err != nil {
		// 日志目录不可写时退回 stderr，不能让应用起不来
		slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
		return func() {}
	}

	multi := io.MultiWriter(os.Stderr, writer)
	handler := slog.NewTextHandler(multi, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(slog.New(handler))
	slog.Info("日志已启用", "dir", dir)

	return func() {
		_ = writer.file.Close()
	}
}
