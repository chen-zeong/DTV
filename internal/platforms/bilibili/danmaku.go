package bilibili

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"dtv/internal/platforms/common"
)

// EmitFunc 由上层注入的事件发射器。
//
// 平台层刻意不 import Wails：这样它既能被单测直接调用，
// 也方便未来换 IPC 实现（只需换一个闭包）。
type EmitFunc func(eventName string, payload any)

// EventDanmakuMessage 与旧项目、以及其它三个平台保持一致。
const EventDanmakuMessage = "danmaku-message"

const (
	// 心跳间隔：B 站 30 秒发一次就够（旧实现也是 30s）。
	heartbeatInterval = 30 * time.Second
	// readTimeout：超过这么久没任何帧就认为连接已死，重连。
	readTimeout = 90 * time.Second
	// maxFrameSize 单帧上限，防止异常大包打爆内存。
	maxFrameSize = 8 << 20
	// dialTimeout 建档连接超时。
	dialTimeout = 12 * time.Second
	// 断线重连退避：1s 起，最多 30s。
	maxBackoff = 30 * time.Second
	// 连接稳定运行超过这个时长后，下一次断线从 1s 重新退避，
	// 不能因为一次长时间挂机断了就永久按 30s 重连。
	stableConnection = 10 * time.Second
)

// B 站 WS 协议的操作码（op）。
const (
	opHeartbeat      uint32 = 2
	opHeartbeatReply uint32 = 3
	opNotification   uint32 = 5
	opAuth           uint32 = 7
	opAuthReply      uint32 = 8
)

// protover=2 表示"客户端接受 zlib 压缩的帧"。
//
// 官方前端现在用 protover=3（brotli），但 2 依然有效（实测 auth 回执 code=0 且有数据），
// 而 zlib 是 Go 标准库自带，不用引第三方 brotli 依赖。
const danmakuProtover = 2

// DanmakuManager 管理"同一时刻只监听一个房间"的弹幕会话。
//
// 与斗鱼/虎牙/抖音的 manager 语义保持一致：切房间会先停掉上一个。
type DanmakuManager struct {
	emit EmitFunc

	mu      sync.Mutex
	current *danmakuSession
	seq     int64
}

// NewDanmakuManager 构造。
func NewDanmakuManager(emit EmitFunc) *DanmakuManager {
	if emit == nil {
		emit = func(string, any) {}
	}
	return &DanmakuManager{emit: emit}
}

// RunningRoom 返回当前正在监听的房间号，没有则为空串。
func (m *DanmakuManager) RunningRoom() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil {
		return ""
	}
	return m.current.roomID
}

// Start 开始监听某个房间（会先停掉上一个）。
func (m *DanmakuManager) Start(roomID string) error {
	text := NormalizeRoomID(roomID)
	if text == "" {
		return fmt.Errorf("房间号为空")
	}

	m.StopAll()

	session, err := newDanmakuSession(m, text)
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.current = session
	m.mu.Unlock()

	go session.run()
	return nil
}

// Stop 停止指定房间（roomID 不为空时只停那个）。
func (m *DanmakuManager) Stop(roomID string) {
	m.mu.Lock()
	session := m.current
	if session != nil && roomID != "" && session.roomID != NormalizeRoomID(roomID) {
		m.mu.Unlock()
		return
	}
	if session != nil {
		m.current = nil
	}
	m.mu.Unlock()

	if session != nil {
		session.stop()
	}
}

// StopAll 停止所有监听。
func (m *DanmakuManager) StopAll() {
	m.mu.Lock()
	session := m.current
	m.current = nil
	m.mu.Unlock()

	if session != nil {
		session.stop()
	}
}

// nextMessageID 生成稳定递增的消息 id。
func (m *DanmakuManager) nextMessageID(roomID string, at int64) string {
	m.mu.Lock()
	m.seq++
	seq := m.seq
	m.mu.Unlock()
	return fmt.Sprintf("bilibili:%s:%d:%d", roomID, at, seq)
}

// emitMessage 推送一条归一化弹幕。
func (m *DanmakuManager) emitMessage(roomID string, msg common.DanmakuMessage) {
	if msg.At == 0 {
		msg.At = time.Now().UnixMilli()
	}
	if msg.ID == "" {
		msg.ID = m.nextMessageID(roomID, msg.At)
	}
	if msg.Kind == "" {
		msg.Kind = string(common.DanmakuChat)
	}

	m.emit(EventDanmakuMessage, common.DanmakuEvent{
		RoomID:   roomID,
		Platform: string(common.PlatformBilibili),
		Message:  msg,
	})
}

// danmakuSession 是一次房间监听会话。
type danmakuSession struct {
	manager *DanmakuManager
	roomID  string

	ctx    context.Context
	cancel context.CancelFunc

	connMu sync.Mutex
	conn   *websocket.Conn

	done chan struct{}
}

// newDanmakuSession 构造会话（此时还没连）。
func newDanmakuSession(manager *DanmakuManager, roomID string) (*danmakuSession, error) {
	ctx, cancel := context.WithCancel(context.Background())
	return &danmakuSession{
		manager: manager,
		roomID:  roomID,
		ctx:     ctx,
		cancel:  cancel,
		done:    make(chan struct{}),
	}, nil
}

// stop 停止会话并关闭连接。
func (s *danmakuSession) stop() {
	s.cancel()

	s.connMu.Lock()
	conn := s.conn
	s.conn = nil
	s.connMu.Unlock()

	if conn != nil {
		_ = conn.CloseNow()
	}

	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
	}
}

// setConn 记录当前连接。
func (s *danmakuSession) setConn(conn *websocket.Conn) {
	s.connMu.Lock()
	s.conn = conn
	s.connMu.Unlock()
}

// clearConn 清掉连接记录。
func (s *danmakuSession) clearConn(conn *websocket.Conn) {
	s.connMu.Lock()
	if s.conn == conn {
		s.conn = nil
	}
	s.connMu.Unlock()
}

// run 是会话主循环：断线后按退避重连，直到会话被 Stop。
//
// 之前这里是“一次性”的：roomInit / danmuInfo / readLoop 任一环节失败，
// run 就直接返回，房间还开着但弹幕永远断了。现在把一次完整的
// “解析地址 → 取 token → 连接 → 读帧” 抽成 connectOnce，由 run 循环调用。
func (s *danmakuSession) run() {
	defer close(s.done)

	logf("[Bilibili Danmaku] 开始监听 room=%s", s.roomID)

	backoff := time.Second
	for {
		started := time.Now()
		err := s.connectOnce()
		if s.ctx.Err() != nil {
			logf("[Bilibili Danmaku %s] 已停止", s.roomID)
			return
		}
		if err != nil {
			logf("[Bilibili Danmaku %s] 连接断开: %v，%s 后重连", s.roomID, err, backoff)
		}

		// 稳定跑过一段时间再断开，说明网络/服务端是偶发问题，
		// 下一次重连不用等 30s。
		if time.Since(started) >= stableConnection {
			backoff = time.Second
		}

		select {
		case <-s.ctx.Done():
			logf("[Bilibili Danmaku %s] 已停止", s.roomID)
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

// connectOnce 执行一次完整的建档 + 连接 + 读帧。
// 返回 nil 表示被 Stop 正常打断；其它错误交给 run 的退避循环。
func (s *danmakuSession) connectOnce() error {
	realID, liveStatus, _, _, err := s.client().roomInit(s.roomID)
	if err != nil {
		return fmt.Errorf("取真实房间号失败: %w", err)
	}
	if liveStatus != 1 && liveStatus != 2 {
		logf("[Bilibili Danmaku %s] 房间未开播（live_status=%d），仍尝试连接", s.roomID, liveStatus)
	}

	token, hosts, err := s.client().danmuInfo(realID)
	if err != nil {
		return fmt.Errorf("取弹幕服务器失败: %w", err)
	}
	if token == "" || len(hosts) == 0 {
		return errors.New("没有可用的弹幕服务器")
	}

	var lastErr error
	for _, host := range hosts {
		if s.ctx.Err() != nil {
			return nil
		}
		url := "wss://" + host + "/sub"
		debugLog("尝试连接 %s（room=%s token=%d 字节）", url, realID, len(token))

		dialCtx, cancel := context.WithTimeout(s.ctx, dialTimeout)
		conn, _, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{
			HTTPHeader: http.Header{
				"User-Agent": {desktopUA},
				"Origin":     {origin},
				"Referer":    {referer},
			},
		})
		cancel()
		if err != nil {
			lastErr = err
			debugLog("连接 %s 失败: %v", host, err)
			continue
		}
		conn.SetReadLimit(maxFrameSize)

		s.setConn(conn)
		runErr := s.readLoop(conn, realID, token)
		s.clearConn(conn)
		_ = conn.CloseNow()

		if runErr == nil {
			// readLoop 只在 ctx 取消时返回 nil。
			return nil
		}
		lastErr = runErr
		debugLog("连接结束: %v", runErr)

		// 有错误时换下一个域名重试
	}

	if lastErr != nil {
		return lastErr
	}
	return errors.New("所有弹幕服务器均连接失败")
}

// client 构造一个临时 HTTP 客户端（复用全局缓存的是包级变量，这里新建即可）。
func (s *danmakuSession) client() *Client {
	return NewClient()
}

// readLoop 发 auth、跑心跳、读帧解析。
func (s *danmakuSession) readLoop(conn *websocket.Conn, realRoomID, token string) error {
	auth := fmt.Sprintf(`{"uid":0,"roomid":%s,"protover":%d,"platform":"web","type":2,"key":%q}`,
		realRoomID, danmakuProtover, token)

	if err := conn.Write(s.ctx, websocket.MessageBinary, encodePacket(opAuth, []byte(auth))); err != nil {
		return fmt.Errorf("发送 auth 失败: %w", err)
	}
	debugLog("已发送 auth（room=%s protover=%d）", realRoomID, danmakuProtover)

	// 心跳协程
	hbCtx, hbCancel := context.WithCancel(s.ctx)
	defer hbCancel()
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-hbCtx.Done():
				return
			case <-ticker.C:
				if err := conn.Write(hbCtx, websocket.MessageBinary, encodePacket(opHeartbeat, []byte("{}"))); err != nil {
					return
				}
				debugLog("已发送心跳")
			}
		}
	}()

	for {
		if s.ctx.Err() != nil {
			return nil
		}

		readCtx, cancel := context.WithTimeout(s.ctx, readTimeout)
		_, data, err := conn.Read(readCtx)
		cancel()
		if err != nil {
			if s.ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("读取帧失败: %w", err)
		}

		s.handleFrame(data)
	}
}

// handleFrame 解析一帧（可能包含多个包，包内还可能嵌套压缩包）。
func (s *danmakuSession) handleFrame(data []byte) {
	packets, err := decodePackets(data, 0)
	if err != nil {
		debugLog("解析帧失败: %v", err)
		return
	}
	for _, p := range packets {
		s.handlePacket(p)
	}
}

// packet 是一个解包后的 JSON 消息。
type packet struct {
	Op         uint32
	Ver        uint16
	Body       []byte
	Popularity int64
}

// handlePacket 按 op 分发。
func (s *danmakuSession) handlePacket(p packet) {
	switch p.Op {
	case opAuthReply:
		code := 0
		var v struct {
			Code int `json:"code"`
		}
		if json.Unmarshal(p.Body, &v) == nil {
			code = v.Code
		}
		debugLog("auth 回执 code=%d", code)
		if code != 0 {
			logf("[Bilibili Danmaku %s] auth 被拒，code=%d", s.roomID, code)
		}
		return
	case opHeartbeatReply:
		// 心跳回执里带人气值（明文 JSON）
		var v struct {
			Popularity any `json:"popularity"`
		}
		if json.Unmarshal(p.Body, &v) == nil && v.Popularity != nil {
			p.Popularity = jsonInt(v.Popularity)
			debugLog("人气值=%d", p.Popularity)
		}
		return
	case opNotification:
		s.handleCommand(p.Body)
		return
	}
}

// handleCommand 处理一条业务消息（JSON 形如 {"cmd":"DANMU_MSG","info":[...]}）。
func (s *danmakuSession) handleCommand(body []byte) {
	var env struct {
		Cmd  string          `json:"cmd"`
		Info json.RawMessage `json:"info"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil || env.Cmd == "" {
		return
	}

	switch env.Cmd {
	case "DANMU_MSG":
		s.handleDanmuMsg(env.Info)
	case "SEND_GIFT":
		s.handleGift(env.Data)
	case "INTERACT_WORD":
		s.handleInteract(env.Data)
	default:
		debugLog("跳过命令 %q", env.Cmd)
	}
}

// handleDanmuMsg 处理聊天弹幕。
//
// DANMU_MSG 的 info 是个"万用数组"，位置约定（实测）：
//
//	info[0][3]   弹幕颜色（十进制 RGB）
//	info[1]      弹幕内容
//	info[2][1]   用户名
//	info[3][0]   用户等级（可能缺失）
func (s *danmakuSession) handleDanmuMsg(raw json.RawMessage) {
	var info []json.RawMessage
	if err := json.Unmarshal(raw, &info); err != nil || len(info) < 3 {
		return
	}

	var content string
	if err := json.Unmarshal(info[1], &content); err != nil || strings.TrimSpace(content) == "" {
		return
	}

	nickname := "匿名"
	var user []json.RawMessage
	if json.Unmarshal(info[2], &user) == nil && len(user) > 1 {
		var name string
		if json.Unmarshal(user[1], &name) == nil && strings.TrimSpace(name) != "" {
			nickname = name
		}
	}

	color := ""
	// 必须解成 []any（而不是 []json.RawMessage）：jsonInt 只认 float64/string，
	// 拿到 RawMessage 会静默返回 0，导致弹幕颜色永远丢失。
	var meta []any
	if json.Unmarshal(info[0], &meta) == nil && len(meta) > 3 {
		color = colorHex(jsonInt(meta[3]))
	}

	level := 0
	if len(info) > 3 {
		var medal []any
		if json.Unmarshal(info[3], &medal) == nil && len(medal) > 0 {
			level = int(jsonInt(medal[0]))
		}
	}

	at := time.Now().UnixMilli()
	s.manager.emitMessage(s.roomID, common.DanmakuMessage{
		ID:       s.manager.nextMessageID(s.roomID, at),
		Nickname: nickname,
		Content:  strings.TrimSpace(content),
		Level:    level,
		Color:    color,
		Kind:     string(common.DanmakuChat),
		At:       at,
	})
}

// handleGift 处理礼物（保留旧项目的行为：礼物也当一条弹幕推给前端）。
func (s *danmakuSession) handleGift(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var gift struct {
		Uname    string `json:"uname"`
		GiftName string `json:"giftName"`
		Num      any    `json:"num"`
		Action   string `json:"action"`
	}
	if err := json.Unmarshal(raw, &gift); err != nil || gift.GiftName == "" {
		return
	}
	if gift.Action == "" {
		gift.Action = "赠送"
	}

	at := time.Now().UnixMilli()
	content := fmt.Sprintf("[礼物] %s %s×%s", gift.Action, gift.GiftName, jsonString(gift.Num))
	s.manager.emitMessage(s.roomID, common.DanmakuMessage{
		ID:       s.manager.nextMessageID(s.roomID, at),
		Nickname: gift.Uname,
		Content:  content,
		Kind:     string(common.DanmakuGift),
		At:       at,
	})
}

// handleInteract 处理进场消息（INTERACT_WORD）。
func (s *danmakuSession) handleInteract(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var data struct {
		Uname string `json:"uname"`
	}
	if err := json.Unmarshal(raw, &data); err != nil || strings.TrimSpace(data.Uname) == "" {
		return
	}

	at := time.Now().UnixMilli()
	s.manager.emitMessage(s.roomID, common.DanmakuMessage{
		ID:       s.manager.nextMessageID(s.roomID, at),
		Nickname: data.Uname,
		Content:  "进入直播间",
		Kind:     string(common.DanmakuEnter),
		At:       at,
	})
}

// danmuInfo 取弹幕服务器 token 与域名列表（WBI 签名）。
func (c *Client) danmuInfo(realRoomID string) (token string, hosts []string, err error) {
	imgKey, subKey, err := c.wbiKeys()
	if err != nil {
		return "", nil, describe("获取 WBI 签名失败", err)
	}

	query := wbiSignedQuery([][2]string{
		{"id", realRoomID},
		{"type", "0"},
		{"web_location", "444.8"},
	}, imgKey, subKey, nowSeconds())

	body, err := c.getRaw(buildURL(urlDanmuInfo, query))
	if err != nil {
		return "", nil, describe("getDanmuInfo 请求失败", err)
	}

	var resp struct {
		Code int64  `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Token    string `json:"token"`
			HostList []struct {
				Host    string `json:"host"`
				WSSPort any    `json:"wss_port"`
			} `json:"host_list"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return "", nil, describe("getDanmuInfo 解析失败", err)
	}
	if resp.Code != 0 {
		return "", nil, &apiError{Code: resp.Code, Message: resp.Msg, Endpoint: "getDanmuInfo"}
	}

	// 域名列表里同一个 host 可能出现多次（不同端口），去重保序
	seen := map[string]bool{}
	for _, h := range resp.Data.HostList {
		host := strings.TrimSpace(h.Host)
		if host == "" || seen[host] {
			continue
		}
		seen[host] = true
		hosts = append(hosts, host)
	}
	return resp.Data.Token, hosts, nil
}

// encodePacket 组装一个 16 字节头 + body 的包。
func encodePacket(op uint32, body []byte) []byte {
	buf := make([]byte, 16+len(body))
	binary.BigEndian.PutUint32(buf[0:], uint32(len(buf))) // pack_len
	binary.BigEndian.PutUint16(buf[4:], 16)               // header_len
	binary.BigEndian.PutUint16(buf[6:], 1)                // ver
	binary.BigEndian.PutUint32(buf[8:], op)               // op
	binary.BigEndian.PutUint32(buf[12:], 1)               // seq
	copy(buf[16:], body)
	return buf
}

// decodePackets 把一帧拆成若干"报文"。
//
// 关键：ver=2 的 body 是 zlib 压缩的 **再次分包** 的数据，
// 解压后还要按 16 字节头继续拆（实测就是这样，不能当成拼接 JSON）。
// 这里用递归实现，深度上限 8 防止畸形数据打爆栈。
func decodePackets(data []byte, depth int) ([]packet, error) {
	if depth > 8 {
		return nil, fmt.Errorf("嵌套层级过深")
	}

	var out []packet
	offset := 0
	for offset+16 <= len(data) {
		packLen := int(binary.BigEndian.Uint32(data[offset:]))
		headerLen := int(binary.BigEndian.Uint16(data[offset+4:]))
		ver := binary.BigEndian.Uint16(data[offset+6:])
		op := binary.BigEndian.Uint32(data[offset+8:])

		if headerLen < 16 {
			headerLen = 16
		}
		if packLen < headerLen+1 || offset+packLen > len(data) {
			break
		}

		body := data[offset+headerLen : offset+packLen]
		offset += packLen

		switch ver {
		case 2: // zlib
			plain, err := inflate(body)
			if err != nil {
				return out, err
			}
			nested, err := decodePackets(plain, depth+1)
			if err != nil {
				return out, err
			}
			out = append(out, nested...)
		case 3: // brotli：本项目用 protover=2，正常不会出现
			return out, fmt.Errorf("收到 brotli 帧（ver=3），当前仅支持 zlib")
		default: // 0/1 = 明文 JSON
			out = append(out, packet{Op: op, Ver: ver, Body: body})
		}
	}
	return out, nil
}

// inflate 解 zlib。
func inflate(data []byte) ([]byte, error) {
	zr, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	out, err := io.ReadAll(io.LimitReader(zr, maxFrameSize))
	if err != nil {
		return nil, err
	}
	return out, nil
}

// colorHex 把十进制 RGB 转成 #RRGGBB；0 或非法值返回空串（前端用默认色）。
func colorHex(color int64) string {
	if color <= 0 {
		return ""
	}
	r := (color >> 16) & 0xFF
	g := (color >> 8) & 0xFF
	b := color & 0xFF
	return fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

var _ = strconv.Itoa
var _ = log.Printf
