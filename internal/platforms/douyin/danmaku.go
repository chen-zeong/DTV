package douyin

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/md5"
	_ "embed"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/dop251/goja"

	"dtv/internal/jssign"
	"dtv/internal/platforms/common"
)

// EmitFunc 与斗鱼/虎牙一致：平台层不依赖 Wails，由 Service 注入事件回调。
type EmitFunc func(eventName string, payload any)

const (
	// EventDanmakuMessage 全局弹幕事件（payload 为 common.DanmakuEvent）。
	EventDanmakuMessage = "danmaku-message"
	eventDanmakuPrefix  = "danmaku-"

	// douyinWSHosts 是抖音弹幕 WS 的候选域名（逐个尝试）。
	douyinWSHostsDefault = "webcast3-ws-web-lq.douyin.com,webcast5-ws-web-lf.douyin.com," +
		"webcast5-ws-web-hl.douyin.com,webcast3-ws-web-hl.douyin.com,webcast3-ws-web-lf.douyin.com"

	heartbeatInterval = 5 * time.Second
	maxBackoff        = 30 * time.Second
	readTimeout       = 90 * time.Second
	dialTimeout       = 15 * time.Second
	maxFrameSize      = 4 << 20
)

//go:embed assets/sign.js
var signJS []byte

// wsSignProgram 缓存编译后的 sign.js（474KB，编译一次约几百毫秒）。
var (
	wsSignOnce    sync.Once
	wsSignProgram *goja.Program
	wsSignErr     error
	// P-10：sign.js 对所有房间是同一份，复用一个 goja 运行时（串行调用）。
	wsSignMu      sync.Mutex
	wsSignRuntime *jssign.Runtime
)

// wsSignature 计算 WS 连接需要的 signature。
//
// 步骤（对齐旧实现 signature.rs）：
//  1. 从 wss URL 的 query 里取固定的 12 个参数，按固定顺序拼成 "k=v,k=v,..."
//  2. 对整个串做 MD5
//  3. 调 sign.js 的 get_sign(md5) 得到最终签名
func wsSignature(wssURL string) (string, error) {
	// 参数顺序必须与旧实现一致，改顺序签名就废
	keys := []string{
		"live_id", "aid", "version_code", "webcast_sdk_version", "room_id",
		"sub_room_id", "sub_channel_id", "did_rule", "user_unique_id",
		"device_platform", "device_type", "ac", "identity",
	}

	values := parseQueryValues(wssURL)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+values[k])
	}
	toSign := strings.Join(parts, ",")

	sum := md5.Sum([]byte(toSign))
	md5Param := hex.EncodeToString(sum[:])

	wsSignOnce.Do(func() {
		wsSignProgram, wsSignErr = jssign.Compile("douyin-sign.js", string(signJS))
	})
	if wsSignErr != nil {
		return "", fmt.Errorf("编译抖音签名脚本失败: %w", wsSignErr)
	}

	// 复用同一个运行时：sign.js 的全局函数名固定，串行调用即可。
	wsSignMu.Lock()
	defer wsSignMu.Unlock()
	if wsSignRuntime == nil {
		wsSignRuntime = jssign.New()
	}
	out, err := wsSignRuntime.RunProgramInThenCall(wsSignProgram, "get_sign('"+md5Param+"')")
	if err != nil {
		return "", fmt.Errorf("执行抖音签名脚本失败: %w", err)
	}
	return strings.TrimSpace(out), nil
}

// parseQueryValues 从 URL 的 query 里取出 key→value（不做解码以外的处理）。
func parseQueryValues(rawURL string) map[string]string {
	out := map[string]string{}
	i := strings.Index(rawURL, "?")
	if i < 0 {
		return out
	}
	query := rawURL[i+1:]
	if j := strings.Index(query, "#"); j >= 0 {
		query = query[:j]
	}
	for _, kv := range strings.Split(query, "&") {
		if kv == "" {
			continue
		}
		eq := strings.Index(kv, "=")
		if eq < 0 {
			continue
		}
		k := kv[:eq]
		v := kv[eq+1:]
		// query 里的值可能被 urlencode 过（如 browser_version 含空格）
		if dec, err := urlUnescape(v); err == nil {
			v = dec
		}
		out[k] = v
	}
	return out
}

// urlUnescape 是 url.QueryUnescape 的薄封装（便于替换/测试）。
func urlUnescape(s string) (string, error) {
	return url.QueryUnescape(s)
}

// buildWSQuery 组装抖音 WS 的 query（顺序与旧实现完全一致）。
func buildWSQuery(cursor, internalExt, userUniqueID, roomID string) string {
	return "webcast/im/push/v2/?app_name=douyin_web&version_code=180800" +
		"&webcast_sdk_version=1.0.14-beta.0&update_version_code=1.0.14-beta.0" +
		"&compress=gzip&device_platform=web&cookie_enabled=true" +
		"&screen_width=1536&screen_height=864&browser_language=zh-CN" +
		"&browser_platform=Win32&browser_name=Mozilla" +
		"&browser_version=5.0%20(Windows%20NT%2010.0;%20Win64;%20x64)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/126.0.0.0%20Safari/537.36" +
		"&browser_online=true&tz_name=Asia/Shanghai" +
		"&cursor=" + cursor +
		"&internal_ext=" + internalExt +
		"&host=https://live.douyin.com&aid=6383&live_id=1&did_rule=3&endpoint=live_pc" +
		"&support_wrds=1&user_unique_id=" + userUniqueID +
		"&im_path=/webcast/im/fetch/&identity=audience&need_persist_msg_count=15" +
		"&insert_task_id=&live_reason=&room_id=" + roomID + "&heartbeatDuration=0"
}

// wsHosts 返回候选 WS 域名（支持环境变量覆盖，便于排查）。
func wsHosts() []string {
	raw := douyinWSHostsDefault
	out := make([]string, 0, 6)
	for _, host := range strings.Split(raw, ",") {
		host = strings.TrimSpace(host)
		if host != "" {
			out = append(out, host)
		}
	}
	return out
}

/* ------------------------------------------------------------- 管理器 */

// DanmakuManager 管理"同一时刻只有一个房间"的抖音弹幕连接。
type DanmakuManager struct {
	mu      sync.Mutex
	session *danmakuSession
	emit    EmitFunc
	seq     atomic.Uint64
	client  *Client
}

// NewDanmakuManager 创建抖音弹幕管理器。
func NewDanmakuManager(emit EmitFunc) *DanmakuManager {
	return &DanmakuManager{emit: emit, client: NewClient()}
}

// Start 开始监听指定房间（会先停掉正在监听的房间）。
func (m *DanmakuManager) Start(roomID string) error {
	trimmed := strings.TrimSpace(roomID)
	if trimmed == "" {
		return fmt.Errorf("缺少房间号")
	}

	m.stopCurrent()

	ctx, cancel := context.WithCancel(context.Background())
	s := &danmakuSession{
		roomID:  trimmed,
		cancel:  cancel,
		done:    make(chan struct{}),
		manager: m,
	}

	m.mu.Lock()
	m.session = s
	m.mu.Unlock()

	go s.run(ctx)
	return nil
}

// Stop 停止监听。
//
// roomID 非空时只停那一个房间：切房间时旧房间的 Stop 可能比新房间的 Start
// 更晚到达，如果无条件停“当前连接”，就会把刚建立的新房间连接一起停掉。
func (m *DanmakuManager) Stop(roomID string) {
	trimmed := strings.TrimSpace(roomID)
	m.mu.Lock()
	current := m.session
	if current == nil || (trimmed != "" && current.roomID != trimmed) {
		m.mu.Unlock()
		return
	}
	m.session = nil
	m.mu.Unlock()

	log.Printf("[Douyin Danmaku] 停止监听 room=%s (request=%s)", current.roomID, roomID)
	current.stop()
}

// StopAll 应用退出时调用。
func (m *DanmakuManager) StopAll() { m.Stop("") }

// RunningRoom 返回当前监听房间号（空表示未监听）。
func (m *DanmakuManager) RunningRoom() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.session == nil {
		return ""
	}
	return m.session.roomID
}

func (m *DanmakuManager) stopCurrent() {
	m.mu.Lock()
	current := m.session
	m.session = nil
	m.mu.Unlock()
	if current != nil {
		current.stop()
	}
}

func (m *DanmakuManager) emitEvent(roomID string, message common.DanmakuMessage) {
	if m.emit == nil {
		return
	}
	payload := common.DanmakuEvent{
		RoomID:   roomID,
		Platform: string(common.PlatformDouyin),
		Message:  message,
	}
	m.emit(EventDanmakuMessage, payload)
	m.emit(eventDanmakuPrefix+roomID, payload)
}

func (m *DanmakuManager) nextMessageID(roomID string, at int64) string {
	return "douyin:" + roomID + ":" + strconv.FormatInt(at, 10) + ":" +
		strconv.FormatUint(m.seq.Add(1), 10)
}

/* ------------------------------------------------------------- 单连接 */

type danmakuSession struct {
	roomID  string
	cancel  context.CancelFunc
	done    chan struct{}
	manager *DanmakuManager
	once    sync.Once

	mu   sync.Mutex
	conn *websocket.Conn
}

func (s *danmakuSession) stop() {
	s.cancel()
	s.closeConn()
	s.once.Do(func() {
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
			log.Printf("[Douyin Danmaku %s] 等待退出超时", s.roomID)
		}
	})
}

func (s *danmakuSession) setConn(conn *websocket.Conn) {
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()
}

func (s *danmakuSession) clearConn(conn *websocket.Conn) {
	s.mu.Lock()
	if s.conn == conn {
		s.conn = nil
	}
	s.mu.Unlock()
}

func (s *danmakuSession) closeConn() {
	s.mu.Lock()
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()
	if conn != nil {
		_ = conn.CloseNow()
	}
}

func (s *danmakuSession) run(ctx context.Context) {
	defer close(s.done)

	backoff := time.Second
	for {
		err := s.connectAndRead(ctx)
		if ctx.Err() != nil {
			log.Printf("[Douyin Danmaku %s] 已停止监听", s.roomID)
			return
		}
		if err != nil {
			log.Printf("[Douyin Danmaku %s] 连接断开: %v，%s 后重连", s.roomID, err, backoff)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

// wsCredentials 是连接弹幕所需的全部凭据。
type wsCredentials struct {
	roomID        string // 内部房间号（19 位）
	userUniqueID  string
	cookie        string
}

// resolveCredentials 从房间页拿内部 room_id、ttwid 等。
func (s *danmakuSession) resolveCredentials() (*wsCredentials, error) {
	webRID := NormalizeRoomID(s.roomID)
	if webRID == "" {
		return nil, fmt.Errorf("抖音房间号无效: %q", s.roomID)
	}

	html, err := s.manager.client.fetchRoomPage(webRID)
	if err != nil {
		return nil, err
	}

	internalID := extractInternalRoomID(html)
	if internalID == "" {
		return nil, fmt.Errorf("抖音房间 %s 页面里没有找到内部 roomId", webRID)
	}

	// cookie / user_unique_id 从 HTTP 客户端记录里取（ttwid 已在页面请求时收下）
	cookie := s.manager.client.cookieString(urlLiveHome + webRID)
	userUniqueID := extractCookieValue(cookie, "s_v_web_id")
	if userUniqueID == "" {
		userUniqueID = extractCookieValue(cookie, "ttwid")
	}
	if userUniqueID == "" {
		userUniqueID = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}

	return &wsCredentials{roomID: internalID, userUniqueID: userUniqueID, cookie: cookie}, nil
}

// connectAndRead 建立一次 WS 连接并读到断开。
func (s *danmakuSession) connectAndRead(ctx context.Context) error {
	creds, err := s.resolveCredentials()
	if err != nil {
		return err
	}

	query := buildWSQuery("", "", creds.userUniqueID, creds.roomID)

	var lastErr error
	for _, host := range wsHosts() {
		base := "wss://" + host + "/" + query
		sig, err := wsSignature(base)
		if err != nil {
			return err
		}
		target := base + "&signature=" + sig
		debugLog("尝试连接 %s（room=%s uid=%s sig 长度=%d）", host, creds.roomID, creds.userUniqueID, len(sig))

		dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
		conn, _, err := websocket.Dial(dialCtx, target, &websocket.DialOptions{
			HTTPHeader: httpHeadersForWS(creds.cookie),
		})
		cancel()
		if err != nil {
			lastErr = fmt.Errorf("连接 %s 失败: %w", host, err)
			debugLog("%v", lastErr)
			continue
		}

		debugLog("已连接 %s", host)
		s.setConn(conn)
		readErr := s.readLoop(ctx, conn, creds)
		s.clearConn(conn)
		_ = conn.CloseNow()
		debugLog("连接结束: %v", readErr)
		return readErr
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("没有可用的抖音弹幕域名")
	}
	return lastErr
}

// readLoop 处理 WS 消息，并负责心跳与 ACK。
func (s *danmakuSession) readLoop(ctx context.Context, conn *websocket.Conn, creds *wsCredentials) error {
	conn.SetReadLimit(maxFrameSize)

	// 心跳协程：每 5 秒发一帧 payload_type=hb
	hbCtx, stopHeartbeat := context.WithCancel(ctx)
	defer stopHeartbeat()
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-hbCtx.Done():
				return
			case <-ticker.C:
				frame := pushFrame{PayloadType: "hb"}.encode()
				if err := conn.Write(hbCtx, websocket.MessageBinary, frame); err != nil {
					return
				}
			}
		}
	}()

	for {
		readCtx, cancelRead := context.WithTimeout(ctx, readTimeout)
		_, data, err := conn.Read(readCtx)
		cancelRead()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		s.handleFrame(conn, data)
	}
}

// handleFrame 解析一帧：解压 → 解析 → ACK → 逐条推弹幕。
func (s *danmakuSession) handleFrame(conn *websocket.Conn, data []byte) {
	frame, err := decodePushFrame(data)
	if err != nil {
		debugLog("解析帧失败: %v", err)
		return
	}
	debugLog("收到帧 type=%q payload=%d 字节", frame.PayloadType, len(frame.Payload))

	if frame.PayloadType != "msg" || len(frame.Payload) == 0 {
		return
	}

	// payload 是 gzip 压缩的 Response
	zr, err := gzip.NewReader(bytes.NewReader(frame.Payload))
	if err != nil {
		debugLog("gzip 打开失败: %v", err)
		return
	}
	plain, err := io.ReadAll(zr)
	_ = zr.Close()
	if err != nil {
		debugLog("gzip 解压失败: %v", err)
		return
	}

	resp, err := decodeResponse(plain)
	if err != nil {
		debugLog("Response 解析失败: %v", err)
		return
	}
	debugLog("Response: 消息数=%d needAck=%v internalExt=%d 字节",
		len(resp.Messages), resp.NeedAck, len(resp.InternalExt))

	// 需要 ACK 时回一帧（payload 是 internalExt 的 protobuf 编码）
	if resp.NeedAck && resp.InternalExt != "" {
		ack := pushFrame{
			LogID:       frame.LogID,
			PayloadType: "ack",
			Payload:     []byte(resp.InternalExt),
		}
		if err := conn.Write(context.Background(), websocket.MessageBinary, ack.encode()); err != nil {
			log.Printf("[Douyin Danmaku %s] 发送 ACK 失败: %v", s.roomID, err)
		} else {
			debugLog("已发送 ACK")
		}
	}

	for _, msg := range resp.Messages {
		if msg.Method != "WebcastChatMessage" {
			debugLog("跳过消息类型 %q（payload=%d 字节）", msg.Method, len(msg.Payload))
			continue
		}
		chat, err := decodeChatMessage(msg.Payload)
		if err != nil || strings.TrimSpace(chat.Content) == "" {
			debugLog("聊天消息内容为空/解析失败（内容=%q err=%v）", chat.Content, err)
			continue
		}
		if chat.Nickname == "" {
			chat.Nickname = "匿名"
		}

		at := time.Now().UnixMilli()
		s.manager.emitEvent(s.roomID, common.DanmakuMessage{
			ID:       s.manager.nextMessageID(s.roomID, at),
			Nickname: chat.Nickname,
			Content:  chat.Content,
			Level:    int(chat.UserLevel),
			Color:    "#FFFFFF", // 聊天消息本身不带颜色
			Kind:     string(common.DanmakuChat),
			At:       at,
		})
	}
}

// httpHeadersForWS 构造 WS 握手头（带 cookie）。
func httpHeadersForWS(cookie string) map[string][]string {
	h := map[string][]string{
		"User-Agent": {desktopUA},
		"Referer":    {urlLiveHome},
		"Origin":     {"https://live.douyin.com"},
	}
	if cookie != "" {
		h["Cookie"] = []string{cookie}
	}
	return h
}

// extractCookieValue 从 "k=v; k2=v2" 里取指定 key 的值。
func extractCookieValue(cookie, key string) string {
	for _, kv := range strings.Split(cookie, ";") {
		kv = strings.TrimSpace(kv)
		if strings.HasPrefix(kv, key+"=") {
			return strings.TrimPrefix(kv, key+"=")
		}
	}
	return ""
}

// debugEnabled 由环境变量 DTV_DANMAKU_DEBUG 控制（排查连接/解码问题用）。
var debugEnabled = os.Getenv("DTV_DANMAKU_DEBUG") != ""

func debugLog(format string, args ...any) {
	if debugEnabled {
		log.Printf("[Douyin Danmaku][debug] "+format, args...)
	}
}

