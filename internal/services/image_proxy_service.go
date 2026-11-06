// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/appdirs"
)

// 单张图片上限 16MB；超过时只返回已读取的部分并断开缓存写入。
const maxImageBytes = 16 << 20

// 磁盘缓存预算：最多 300MB / 保留 7 天。
const (
	imageCacheMaxBytes = 300 << 20
	imageCacheMaxAge   = 7 * 24 * time.Hour
)

// ImageProxyInfo 是图片代理服务的启动信息。
type ImageProxyInfo struct {
	// BaseURL 形如 http://127.0.0.1:52341，前端在后面拼 /image?url=...
	BaseURL string `json:"baseUrl"`
	// Token 每次启动随机生成，防止本机其它网页滥用本地代理。
	Token string `json:"token"`
}

// ImageProxyService 是本地图片代理。
//
// 为什么需要它：
//   - B 站的头像 / 封面 CDN 会校验 Referer，WebView 直接 <img> 会拿到 403；
//   - 斗鱼头像字段 av 只有相对路径，部分 CDN 会拒绝没有来源页的请求；
//   - WebView 里直接加载远端图片时，http/https 混合内容也容易出问题。
//
// 代理只监听 127.0.0.1 的随机端口，只允许已知的图片 CDN，校验返回的
// Content-Type 是 image/*，并要求每次启动生成的随机 token，因此不是通用 HTTP 代理。
type ImageProxyService struct {
	mu       sync.Mutex
	server   *http.Server
	baseURL  string
	token    string
	client   *http.Client
	cacheDir string

	// 同一个图片 URL 的并发请求只回源一次；flutter/WebView 在快速切平台时
	// 很容易对同一张图发出多个请求，重复回源会明显拖慢首屏。
	fetchLocks sync.Map // key -> *sync.Mutex
	// 限制同时回源的图片数量，避免一次切换平台把上游 CDN 打满。
	fetchSem chan struct{}
}

// NewImageProxyService 创建图片代理服务。
func NewImageProxyService() *ImageProxyService {
	s := &ImageProxyService{fetchSem: make(chan struct{}, 20)}

	transport := &http.Transport{
		// 与项目其它客户端一致：图片 CDN 直连，不走系统代理（走代理反而慢/被风控）。
		Proxy: nil,
		// B 站封面一页几十张，全部来自 i0.hdslb.com；HTTP/2 多路复用 +
		// 更大的 per-host 连接池能明显减少首屏排队。
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	s.client = &http.Client{
		Transport: transport,
		Timeout:   18 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("图片重定向次数过多")
			}
			if _, err := normalizeRemoteImageURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}

	return s
}

// EnsureStarted 启动代理并返回基础地址；重复调用会复用同一个实例。
func (s *ImageProxyService) EnsureStarted() (*ImageProxyInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.baseURL != "" && s.server != nil {
		return &ImageProxyInfo{BaseURL: s.baseURL, Token: s.token}, nil
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("启动图片代理失败：%w", err)
	}

	if s.cacheDir == "" {
		s.cacheDir = appdirs.Ensure(appdirs.ImageCacheDir())
	}
	if s.token == "" {
		s.token = randomToken()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/image", s.handleImage)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 8 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	s.server = server
	s.baseURL = "http://" + listener.Addr().String()

	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			slog.Error("图片代理退出", "error", serveErr)
		}
	}()
	go s.pruneCache()

	return &ImageProxyInfo{BaseURL: s.baseURL, Token: s.token}, nil
}

// ServiceShutdown 在应用退出时关闭本地代理。
func (s *ImageProxyService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.server.Shutdown(ctx)
		s.server = nil
		s.baseURL = ""
	}
	return nil
}

func (s *ImageProxyService) handleImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if token := strings.TrimSpace(r.URL.Query().Get("t")); token == "" || token != s.token {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}

	target, err := normalizeRemoteImageURL(raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	width := parseImageWidth(r.URL.Query().Get("w"))
	cacheWidth := 0
	if width > 0 && applyCDNResize(target, width) {
		cacheWidth = width
	}

	// HEAD：只回元信息，不拉整张图（P-06）。
	if r.Method == http.MethodHead {
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		if ct := mime.TypeByExtension(filepath.Ext(target.Path)); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	// 同一张图（有效宽度相同）的请求串行化：第一个请求回源并落盘，
	// 后面的请求直接命中磁盘缓存，不再重复打上游 CDN。
	lock := s.cacheLock(target, cacheWidth)
	lock.Lock()
	defer lock.Unlock()

	if s.serveFromCache(w, target, cacheWidth) {
		return
	}

	s.fetchAndStream(w, r, target, cacheWidth)
}

func (s *ImageProxyService) cacheLock(target *url.URL, width int) *sync.Mutex {
	key := target.String()
	if width > 0 {
		key = fmt.Sprintf("%s#w=%d", key, width)
	}
	actual, _ := s.fetchLocks.LoadOrStore(key, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

func (s *ImageProxyService) fetchAndStream(
	w http.ResponseWriter,
	r *http.Request,
	target *url.URL,
	width int,
) {
	// 并发回源上限：快速切平台时可能同时出现几十张封面，全部打到 CDN
	// 容易让单张图排队超时；这里限制并发，排队请求仍然走本地缓存。
	select {
	case s.fetchSem <- struct{}{}:
		defer func() { <-s.fetchSem }()
	case <-r.Context().Done():
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, "invalid image url", http.StatusBadRequest)
		return
	}
	applyImageHeaders(req, target)

	resp, err := s.client.Do(req)
	if err != nil {
		http.Error(w, "fetch image failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("upstream image status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	mediaType, _, parseErr := mime.ParseMediaType(contentType)
	if parseErr != nil || !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		http.Error(w, "upstream is not an image", http.StatusBadGateway)
		return
	}

	if resp.ContentLength > 0 && resp.ContentLength <= maxImageBytes {
		w.Header().Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)

	// 流式转发：一边写响应一边落盘缓存，不再把整张图读进内存（P-06）。
	tmpPath, tmpFile := s.createCacheTemp(target, width)
	writer := io.Writer(w)
	if tmpFile != nil {
		writer = io.MultiWriter(w, tmpFile)
	}
	_, copyErr := io.Copy(writer, io.LimitReader(resp.Body, maxImageBytes))
	if tmpFile != nil {
		_ = tmpFile.Close()
		if copyErr != nil {
			_ = os.Remove(tmpPath)
		} else {
			s.commitCacheFile(tmpPath, target, width, contentType)
		}
	}
}

func (s *ImageProxyService) serveFromCache(w http.ResponseWriter, target *url.URL, width int) bool {
	path, typePath := s.cachePaths(target, width)
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	info, statErr := file.Stat()
	if statErr != nil || time.Since(info.ModTime()) > imageCacheMaxAge {
		_ = file.Close()
		return false
	}
	contentType := "application/octet-stream"
	if raw, readErr := os.ReadFile(typePath); readErr == nil {
		if value := strings.TrimSpace(string(raw)); value != "" {
			contentType = value
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file)
	_ = file.Close()
	// 触摸文件，LRU 清理时保留最近访问的图片。
	now := time.Now()
	_ = os.Chtimes(path, now, now)
	return true
}

// Prefetch 在后台预取一组图片到磁盘缓存。
//
// 浏览器对同一个 localhost 源通常只有 6 条 HTTP/1.1 连接，列表一页几十张
// 封面时会按 6 张一批排队；快速切平台时旧请求还没结束，新请求又来了。
// 这里由 Go 以 8 路并发直接把前几张图拉到本地缓存，等 <img> 真正请求时
// 直接命中磁盘，避免被浏览器连接数卡住。
//
// 只预取列表前几张，失败的 URL 静默跳过；不阻塞调用方。
func (s *ImageProxyService) Prefetch(urls []string, width int) error {
	if len(urls) == 0 {
		return nil
	}
	if width <= 0 {
		width = 320
	}
	if width < 80 {
		width = 80
	}
	if width > 1600 {
		width = 1600
	}

	s.mu.Lock()
	if s.cacheDir == "" {
		s.cacheDir = appdirs.Ensure(appdirs.ImageCacheDir())
	}
	s.mu.Unlock()

	// 去重并限制数量：前 24 张足够覆盖首屏和一行预取。
	seen := make(map[string]struct{}, len(urls))
	unique := make([]string, 0, len(urls))
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if _, ok := seen[raw]; ok {
			continue
		}
		seen[raw] = struct{}{}
		unique = append(unique, raw)
		if len(unique) >= 24 {
			break
		}
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for _, raw := range unique {
		wg.Add(1)
		go func(raw string) {
			defer wg.Done()

			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancel()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}

			target, err := normalizeRemoteImageURL(raw)
			if err != nil {
				return
			}
			cacheWidth := 0
			if applyCDNResize(target, width) {
				cacheWidth = width
			}

			lock := s.cacheLock(target, cacheWidth)
			lock.Lock()
			defer lock.Unlock()
			if s.hasCache(target, cacheWidth) {
				return
			}

			s.fetchToCache(ctx, target, cacheWidth)
		}(raw)
	}
	wg.Wait()
	return nil
}

func (s *ImageProxyService) hasCache(target *url.URL, width int) bool {
	path, _ := s.cachePaths(target, width)
	info, err := os.Stat(path)
	return err == nil && info.Size() > 0 && time.Since(info.ModTime()) <= imageCacheMaxAge
}

func (s *ImageProxyService) fetchToCache(ctx context.Context, target *url.URL, width int) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return
	}
	applyImageHeaders(req, target)

	resp, err := s.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	mediaType, _, parseErr := mime.ParseMediaType(contentType)
	if parseErr != nil || !strings.HasPrefix(strings.ToLower(mediaType), "image/") {
		return
	}

	tmpPath, tmpFile := s.createCacheTemp(target, width)
	if tmpFile == nil {
		return
	}
	_, copyErr := io.Copy(tmpFile, io.LimitReader(resp.Body, maxImageBytes))
	closeErr := tmpFile.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmpPath)
		return
	}
	s.commitCacheFile(tmpPath, target, width, contentType)
}

func (s *ImageProxyService) createCacheTemp(target *url.URL, width int) (string, *os.File) {
	if s.cacheDir == "" {
		return "", nil
	}
	path, _ := s.cachePaths(target, width)
	tmp, err := os.CreateTemp(s.cacheDir, "img-*.tmp")
	if err != nil {
		return "", nil
	}
	_ = path
	return tmp.Name(), tmp
}

func (s *ImageProxyService) commitCacheFile(tmpPath string, target *url.URL, width int, contentType string) {
	path, typePath := s.cachePaths(target, width)
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return
	}
	_ = os.WriteFile(typePath, []byte(contentType), 0o644)
}

func (s *ImageProxyService) cachePaths(target *url.URL, width int) (string, string) {
	key := target.String()
	if width > 0 {
		key = fmt.Sprintf("%s#w=%d", key, width)
	}
	sum := sha256.Sum256([]byte(key))
	base := hex.EncodeToString(sum[:16])
	path := filepath.Join(s.cacheDir, base+".img")
	return path, path + ".type"
}

// pruneCache 做一次轻量 LRU 清理：先删过期文件，再按访问时间删除到预算以内。
func (s *ImageProxyService) pruneCache() {
	if s.cacheDir == "" {
		return
	}
	entries, err := os.ReadDir(s.cacheDir)
	if err != nil {
		return
	}
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	items := make([]item, 0, len(entries))
	var total int64
	now := time.Now()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".img") {
			continue
		}
		path := filepath.Join(s.cacheDir, entry.Name())
		info, statErr := entry.Info()
		if statErr != nil {
			continue
		}
		if now.Sub(info.ModTime()) > imageCacheMaxAge {
			_ = os.Remove(path)
			_ = os.Remove(path + ".type")
			continue
		}
		items = append(items, item{path: path, size: info.Size(), mod: info.ModTime()})
		total += info.Size()
	}
	if total <= imageCacheMaxBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })
	for _, entry := range items {
		if total <= imageCacheMaxBytes {
			break
		}
		if err := os.Remove(entry.path); err == nil {
			_ = os.Remove(entry.path + ".type")
			total -= entry.size
		}
	}
}

func randomToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}

func parseImageWidth(raw string) int {
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0
	}
	if value < 80 {
		value = 80
	}
	if value > 1600 {
		value = 1600
	}
	return value
}

// applyCDNResize 直接让 CDN 出缩放后的图，避免本地解码/编码的 CPU 成本。
// 返回 true 表示 URL 已按宽度改写，false 表示该 CDN 不支持/不需要改写。
func applyCDNResize(u *url.URL, width int) bool {
	host := strings.ToLower(u.Hostname())
	switch {
	case isHostOrSubdomain(host, "douyucdn.cn"), isHostOrSubdomain(host, "douyu.com"):
		query := u.Query()
		if query.Get("x-oss-process") == "" {
			query.Set("x-oss-process", fmt.Sprintf("image/resize,w_%d", width))
			u.RawQuery = query.Encode()
			return true
		}
		return false
	case isHostOrSubdomain(host, "hdslb.com"), isHostOrSubdomain(host, "bilibili.com"):
		if strings.Contains(u.Path, "@") {
			return false
		}
		u.Path += fmt.Sprintf("@%dw.webp", width)
		return true
	default:
		return false
	}
}

// normalizeRemoteImageURL 校验并修补远端图片地址。
//
// 斗鱼目录接口返回的 av 是 “avatar_v3/202004/xxx” 这种没有扩展名的路径，
// 正确地址需要在末尾补 `_big.jpg`。这里是所有历史关注记录的最后一道兜底，
// 即使 localStorage 里存的是旧地址，也能正常显示头像。
func normalizeRemoteImageURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("empty image url")
	}
	if strings.HasPrefix(trimmed, "//") {
		trimmed = "https:" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, errors.New("invalid image url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("only http/https images are allowed")
	}
	if u.User != nil || u.Hostname() == "" {
		return nil, errors.New("invalid image host")
	}
	if !isAllowedImageHost(u.Hostname()) {
		return nil, errors.New("image host is not allowed")
	}

	// 只修 CDN 上的斗鱼头像路径，其它 URL 原样保留。
	// 老数据里既有 avatar_v3 也有 avanew/face，统一按“末段没有扩展名就补 _big.jpg”处理。
	if isHostOrSubdomain(u.Hostname(), "douyucdn.cn") && strings.Contains(u.Path, "/upload/") {
		base := u.Path[strings.LastIndex(u.Path, "/")+1:]
		if base != "" && !strings.Contains(base, ".") && !strings.Contains(base, "@") {
			u.Path += "_big.jpg"
		}
	}

	return u, nil
}

func isHostOrSubdomain(host, suffix string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	s := strings.ToLower(strings.TrimPrefix(suffix, "."))
	return h == s || strings.HasSuffix(h, "."+s)
}

func isAllowedImageHost(host string) bool {
	// R-05：收紧到实际的图片 CDN 子域，不再放行平台主域。
	allowed := []string{
		"douyucdn.cn",
		"hdslb.com",
		"bilivideo.com",
		"acgvideo.com",
		"msstatic.com",
		"huyacdn.com",
		"douyinpic.com",
		"douyincdn.com",
		"byteimg.com",
		"pstatp.com",
		"snssdk.com",
	}
	for _, suffix := range allowed {
		if isHostOrSubdomain(host, suffix) {
			return true
		}
	}
	return false
}

func applyImageHeaders(req *http.Request, target *url.URL) {
	host := strings.ToLower(target.Hostname())
	referer := ""
	switch {
	case isHostOrSubdomain(host, "douyucdn.cn"), isHostOrSubdomain(host, "douyu.com"):
		referer = "https://www.douyu.com/"
	case isHostOrSubdomain(host, "hdslb.com"), isHostOrSubdomain(host, "bilibili.com"),
		isHostOrSubdomain(host, "bilivideo.com"), isHostOrSubdomain(host, "acgvideo.com"):
		referer = "https://live.bilibili.com/"
	case isHostOrSubdomain(host, "msstatic.com"), isHostOrSubdomain(host, "huya.com"),
		isHostOrSubdomain(host, "huyacdn.com"):
		referer = "https://www.huya.com/"
	case isHostOrSubdomain(host, "douyinpic.com"), isHostOrSubdomain(host, "douyincdn.com"),
		isHostOrSubdomain(host, "byteimg.com"), isHostOrSubdomain(host, "bytedance.com"),
		isHostOrSubdomain(host, "pstatp.com"), isHostOrSubdomain(host, "snssdk.com"):
		referer = "https://live.douyin.com/"
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
}
