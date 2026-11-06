package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/douyu"
)

// stream_relay_service.go 把 PR #154 的"斗鱼直链续流"接到 Wails 这一侧。
//
// 与老 Tauri 版的结构对应关系：
//   - 老版：Rust 里的 actix 代理（proxy.rs）+ flv_relay.rs，
//     前端把播放地址换成本地代理地址；
//   - 这里：同样是一个只监听 127.0.0.1 的小 HTTP 服务，
//     前端调 PrepareDouyu 拿到本地地址再交给 xgplayer。
//
// 只有斗鱼需要续流：虎牙 / B 站 / 抖音的直链没有 300 秒硬期限，
// 传进来的会话 resolve 时按平台分流，未登记的平台保持"一次性直通"。

const (
	// relaySessionIdle 是没有客户端再连接后多久回收会话。
	relaySessionIdle = 30 * time.Minute
	// relayMaxSessions 是会话数量上限（切清晰度/线路会各产生一个）。
	relayMaxSessions = 64
)

// RelayStreamInfo 是给前端的本地播放地址。
type RelayStreamInfo struct {
	URL string `json:"url"`
	// 平台内部标识，便于前端排错时打日志
	SessionID string `json:"sessionId"`
}

type relaySession struct {
	id         string
	platform   string
	roomID     string
	quality    string
	line       string
	createdAt  time.Time
	lastAccess time.Time
}

// StreamRelayService 是本地直播流中继（目前只对斗鱼启用续流）。
type StreamRelayService struct {
	mu       sync.Mutex
	server   *http.Server
	baseURL  string
	token    string
	sessions map[string]*relaySession
	client   *http.Client
	douyu    *douyu.Client
}

// NewStreamRelayService 创建中继服务。
//
// douyuClient 与 DouyuService 共用同一个实例：登录 Cookie 由 DouyuService
// 写入，中继续流时必须复用同一份登录态，否则登录用户的原画会被中继按游客
// 档位重新解析。
//
// 上游 HTTP 客户端必须放开"老式 RSA 密钥交换"的密码套件：
// 斗鱼边缘节点（*.edgesrv.com）只提供 RSA 套件、不支持 ECDHE，而 Go 默认
// 密码套件全部要求前向保密，直连会得到 "tls: handshake failure"。
func NewStreamRelayService(douyuClient *douyu.Client) *StreamRelayService {
	if douyuClient == nil {
		douyuClient = douyu.NewClient()
	}
	transport := &http.Transport{
		// 与项目其它请求一致：直连，不走系统代理。
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		MaxIdleConns:          8,
		IdleConnTimeout:       90 * time.Second,
		ForceAttemptHTTP2:     false,
		TLSClientConfig: &tls.Config{
			// 该 CDN 有的节点只到 TLS 1.1，故不能强制 1.2。
			MinVersion: tls.VersionTLS10,
			CipherSuites: []uint16{
				tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_RSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_RSA_WITH_AES_256_CBC_SHA,
				tls.TLS_RSA_WITH_AES_128_CBC_SHA,
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			},
		},
	}

	return &StreamRelayService{
		sessions: make(map[string]*relaySession),
		client:   &http.Client{Transport: transport},
		douyu:    douyuClient,
	}
}

// ServiceShutdown 在应用退出时关闭中继服务。
func (s *StreamRelayService) ServiceShutdown() error {
	s.mu.Lock()
	server := s.server
	s.server = nil
	s.baseURL = ""
	s.sessions = make(map[string]*relaySession)
	s.mu.Unlock()

	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
	return nil
}

// PrepareDouyu 登记一次斗鱼续流会话，返回本地播放地址。
//
// 同一个 (房间, 清晰度, 线路) 复用同一个会话，所以切回原清晰度不会新建。
func (s *StreamRelayService) PrepareDouyu(roomID, quality, line string) (*RelayStreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, errors.New("缺少房间号")
	}
	return s.prepare("douyu", roomID, strings.TrimSpace(quality), strings.TrimSpace(line))
}

func (s *StreamRelayService) prepare(platform, roomID, quality, line string) (*RelayStreamInfo, error) {
	if err := s.ensureStarted(); err != nil {
		return nil, err
	}

	id := relaySessionID(platform, roomID, quality, line)
	now := time.Now()

	s.mu.Lock()
	if existing, ok := s.sessions[id]; ok {
		existing.lastAccess = now
		baseURL, token := s.baseURL, s.token
		s.mu.Unlock()
		return &RelayStreamInfo{
			URL:       relayURL(baseURL, token, id),
			SessionID: id,
		}, nil
	}
	// 顺手回收过期会话，并做数量上限。
	for key, session := range s.sessions {
		if now.Sub(session.lastAccess) > relaySessionIdle {
			delete(s.sessions, key)
		}
	}
	if len(s.sessions) >= relayMaxSessions {
		var oldestKey string
		var oldest time.Time
		for key, session := range s.sessions {
			if oldestKey == "" || session.lastAccess.Before(oldest) {
				oldestKey, oldest = key, session.lastAccess
			}
		}
		delete(s.sessions, oldestKey)
	}
	s.sessions[id] = &relaySession{
		id:         id,
		platform:   platform,
		roomID:     roomID,
		quality:    quality,
		line:       line,
		createdAt:  now,
		lastAccess: now,
	}
	baseURL, token := s.baseURL, s.token
	s.mu.Unlock()

	return &RelayStreamInfo{URL: relayURL(baseURL, token, id), SessionID: id}, nil
}

func relayURL(baseURL, token, id string) string {
	return fmt.Sprintf("%s/stream?id=%s&t=%s", baseURL, id, token)
}

func relaySessionID(platform, roomID, quality, line string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{platform, roomID, quality, line}, "|")))
	return hex.EncodeToString(sum[:8])
}

// ensureStarted 按需启动本地 HTTP 服务。
func (s *StreamRelayService) ensureStarted() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server != nil && s.baseURL != "" {
		return nil
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("启动直播流中继失败：%w", err)
	}
	if s.token == "" {
		buf := make([]byte, 16)
		if _, randErr := rand.Read(buf); randErr == nil {
			s.token = hex.EncodeToString(buf)
		} else {
			s.token = strconv.FormatInt(time.Now().UnixNano(), 36)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/stream", s.handleStream)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 8 * time.Second,
		// 直播流是长连接，不能设 WriteTimeout。
		IdleTimeout: 120 * time.Second,
	}

	s.server = server
	s.baseURL = "http://" + listener.Addr().String()

	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			slog.Error("直播流中继退出", "error", serveErr)
		}
	}()

	return nil
}

func (s *StreamRelayService) handleStream(w http.ResponseWriter, r *http.Request) {
	setRelayCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	token := s.token
	session := s.sessions[strings.TrimSpace(r.URL.Query().Get("id"))]
	if session != nil {
		session.lastAccess = time.Now()
	}
	var snapshot relaySession
	if session != nil {
		snapshot = *session
	}
	s.mu.Unlock()

	if token == "" || strings.TrimSpace(r.URL.Query().Get("t")) != token {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if session == nil {
		http.Error(w, "unknown relay session", http.StatusNotFound)
		return
	}

	ctx := r.Context()
	upstream, err := s.resolveStreamURL(ctx, snapshot)
	if err != nil {
		slog.Warn("直播流中继取流失败", "room", snapshot.roomID, "error", err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	body, err := s.openUpstream(ctx, upstream, snapshot.roomID)
	if err != nil {
		slog.Warn("直播流中继连接上游失败", "room", snapshot.roomID, "error", err)
		code := http.StatusBadGateway
		if errors.Is(err, errStreamOffline) {
			code = http.StatusServiceUnavailable
		}
		http.Error(w, err.Error(), code)
		return
	}

	if r.Method == http.MethodHead {
		_ = body.Close()
		w.Header().Set("Content-Type", "video/x-flv")
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Content-Type", "video/x-flv")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	flush := func() {
		if flusher != nil {
			flusher.Flush()
		}
	}
	flush()

	open := func(ctx context.Context) (io.ReadCloser, error) {
		target, resolveErr := s.resolveStreamURL(ctx, snapshot)
		if resolveErr != nil {
			return nil, resolveErr
		}
		return s.openUpstream(ctx, target, snapshot.roomID)
	}

	renew := snapshot.platform == "douyu"
	relayFlv(ctx, flvSink{w: w, flush: flush}, body, open, renew,
		func(elapsed time.Duration, switchErr error) {
			if switchErr != nil {
				slog.Warn("直播流续流失败，准备重试",
					"room", snapshot.roomID, "segment", elapsed.Round(time.Second), "error", switchErr)
				return
			}
			slog.Info("直播流已接续新的一段",
				"room", snapshot.roomID, "segment", elapsed.Round(time.Second))
		})
}

func setRelayCORS(w http.ResponseWriter) {
	// xgplayer 用 fetch 拉流，WebView 里属于跨源请求，必须放行。
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Accept, Content-Type")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")
}

// errStreamOffline 表示主播没开播 / 取流接口明确说没有流。
var errStreamOffline = errors.New("主播未开播")

// resolveStreamURL 按平台重新取一条直链（续流时会被反复调用）。
func (s *StreamRelayService) resolveStreamURL(_ context.Context, session relaySession) (string, error) {
	switch session.platform {
	case "douyu":
		target, err := s.douyu.StreamURL(session.roomID, session.quality, session.line)
		if err != nil {
			if strings.Contains(err.Error(), "未开播") {
				return "", fmt.Errorf("%w：%v", errStreamOffline, err)
			}
			return "", err
		}
		return target, nil
	default:
		return "", fmt.Errorf("暂不支持 %s 的直播流中继", session.platform)
	}
}

// openUpstream 打开一条上游流，并把上游的错误状态原样带回来。
func (s *StreamRelayService) openUpstream(
	ctx context.Context,
	target string,
	roomID string,
) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("上游地址不合法：%w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "video/x-flv,application/octet-stream,*/*")
	req.Header.Set("Range", "bytes=0-")
	req.Header.Set("Connection", "keep-alive")
	if roomID != "" {
		req.Header.Set("Referer", "https://www.douyu.com/"+roomID)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接上游失败：%w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("上游返回 HTTP %d：%s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	return resp.Body, nil
}
