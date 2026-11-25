package douyu

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

// EmitFunc 是平台层向外发事件的抽象，脱离 Wails 以便单测。
type EmitFunc = common.DanmakuEmitFunc

// EventDanmakuMessage 全局弹幕事件名（兼容旧引用）。
const EventDanmakuMessage = common.EventDanmakuMessage

// 斗鱼弹幕服务器的连接方式。
//
// ⚠️ 与旧项目的重要差异：旧 Rust 代码连的是 `wss://danmuproxy.douyu.com:8506/`，
// 实测该端口已经不再提供 TLS/WebSocket 服务（Go 与 Node 客户端都在 TLS 握手阶段
// 被服务端拒绝，8501~8506 一律无响应）。而 **8601/8602 上是明文 TCP + STT 私有协议**，
// 发 loginreq 后能正常收到 loginres/uenter/chatmsg（已实测验证）。
//
// 因此这里改用裸 TCP。协议报文与旧实现完全一致（同为一套 STT 包格式），
// 差别仅在传输层：TCP 需要自己按长度字段切包，WebSocket 时代一个 message 就是一个包。
var danmakuEndpoints = []string{
	"danmuproxy.douyu.com:8601",
	"danmuproxy.douyu.com:8602",
	"danmuproxy.douyu.com:8603",
}

const (
	// 心跳间隔，对齐旧实现（45s）。
	heartbeatInterval = 45 * time.Second
	// 单次读等待上限。设有限值是为了让"停止监听"能及时生效：
	// 主动关连接是主手段，deadline 只是兜底。
	readTimeout = 90 * time.Second
	// 建连超时。
	dialTimeout = 10 * time.Second
	// 重连退避上限。
	maxBackoff = 30 * time.Second
	// 单包长度上限（防止脏包把内存打爆）。actqzs_* 这类活动包可以到 2KB+。
	maxPacketSize = 1 << 16
)

// DanmakuManager 管理斗鱼弹幕连接，通过共享 DanmakuHub 保证跨平台同时只监听一个房间。
type DanmakuManager struct {
	ctrl *common.DanmakuController
}

// NewDanmakuManager 创建管理器；emit 为 nil 时事件会被丢弃（便于单测）。
func NewDanmakuManager(emit EmitFunc, hub ...*common.DanmakuHub) *DanmakuManager {
	var shared *common.DanmakuHub
	if len(hub) > 0 {
		shared = hub[0]
	}
	return &DanmakuManager{
		ctrl: common.NewDanmakuController(common.PlatformDouyu, emit, shared),
	}
}

// Start 开始监听指定房间的弹幕（会先停掉全局正在监听的房间）。
func (m *DanmakuManager) Start(roomID string) error {
	trimmed := strings.TrimSpace(roomID)
	if trimmed == "" {
		return fmt.Errorf("缺少房间号")
	}

	s := &danmakuSession{
		roomID:  trimmed,
		manager: m,
	}
	m.ctrl.Start(trimmed, func(ctx context.Context) {
		common.RunDanmakuLoop(ctx, "Douyu Danmaku "+trimmed, 10*time.Second, maxBackoff, s.connectAndRead)
	}, s.closeConn)
	return nil
}

// Stop 停止监听（roomID 非空时仅在房间匹配时停掉）。
func (m *DanmakuManager) Stop(roomID string) { m.ctrl.Stop(roomID) }

// StopAll 在应用退出时调用。
func (m *DanmakuManager) StopAll() { m.ctrl.StopAll() }

// RunningRoom 返回当前正在监听的房间号（空表示没有）。
func (m *DanmakuManager) RunningRoom() string { return m.ctrl.RunningRoom() }

func (m *DanmakuManager) emitEvent(roomID string, message common.DanmakuMessage) {
	m.ctrl.Emit(roomID, message, true)
}

func (m *DanmakuManager) nextMessageID(roomID string, at int64) string {
	return m.ctrl.NextMessageID(roomID, at)
}

// ------------------------------------------------------------------ 单个连接

type danmakuSession struct {
	roomID  string
	manager *DanmakuManager

	mu   sync.Mutex
	conn net.Conn
}

func (s *danmakuSession) setConn(conn net.Conn) {
	s.mu.Lock()
	s.conn = conn
	s.mu.Unlock()
}

func (s *danmakuSession) clearConn(conn net.Conn) {
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
		_ = conn.Close()
	}
}

// connectAndRead 建立一次连接并读到断开为止。
func (s *danmakuSession) connectAndRead(ctx context.Context) error {
	conn, err := dialDanmaku(ctx)
	if err != nil {
		return err
	}
	s.setConn(conn)
	defer func() {
		s.clearConn(conn)
		_ = conn.Close()
	}()

	// 登录 + 加房间（顺序与旧实现一致）
	if err := writeSTT(conn, fmt.Sprintf("type@=loginreq/roomid@=%s/", s.roomID)); err != nil {
		return fmt.Errorf("发送登录包失败: %w", err)
	}
	if err := writeSTT(conn, fmt.Sprintf("type@=joingroup/rid@=%s/gid@=1/", s.roomID)); err != nil {
		return fmt.Errorf("发送加房间包失败: %w", err)
	}

	// 心跳协程
	heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
	defer stopHeartbeat()
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				if err := writeSTT(conn, "type@=mrkl/"); err != nil {
					return
				}
			}
		}
	}()

	for {
		// 设 deadline：既能让 ctx 取消及时生效，也能识别"服务端静默"的半死连接。
		_ = conn.SetReadDeadline(time.Now().Add(readTimeout))

		packet, err := readSTTPacket(conn)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		s.handlePacket(conn, packet)
	}
}

// dialDanmaku 依次尝试候选服务器，返回第一个连上的。
func dialDanmaku(ctx context.Context) (net.Conn, error) {
	var lastErr error
	for _, endpoint := range danmakuEndpoints {
		dialer := &net.Dialer{Timeout: dialTimeout}
		dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
		conn, err := dialer.DialContext(dialCtx, "tcp", endpoint)
		cancel()
		if err == nil {
			return conn, nil
		}
		lastErr = fmt.Errorf("%s: %w", endpoint, err)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("没有可用的斗鱼弹幕服务器")
	}
	return nil, fmt.Errorf("连接斗鱼弹幕服务器失败（%w）", lastErr)
}

// handlePacket 解析一个 STT 包并把弹幕推给前端。
//
// 取包范围是 packet[12:len-1]（跳过 12 字节头、去掉尾部 \0），与旧实现一致。
func (s *danmakuSession) handlePacket(conn net.Conn, packet []byte) {
	body := string(packet[12 : len(packet)-1])
	fields := parseSTT(body)

	switch fields["type"] {
	case "chatmsg":
		at := time.Now().UnixMilli()
		s.manager.emitEvent(s.roomID, common.DanmakuMessage{
			ID:       s.manager.nextMessageID(s.roomID, at),
			Nickname: firstNonEmpty(fields["nn"], "未知用户"),
			Content:  fields["txt"],
			Level:    atoiSafe(fields["level"]),
			Color:    colorFromDouyuCol(fields["col"]),
			Kind:     string(common.DanmakuChat),
			At:       at,
		})

	case "uenter":
		// 进房提醒：旧前端把它当独立事件，新 UI 统一成 kind=enter。
		at := time.Now().UnixMilli()
		s.manager.emitEvent(s.roomID, common.DanmakuMessage{
			ID:       s.manager.nextMessageID(s.roomID, at),
			Nickname: firstNonEmpty(fields["nn"], "未知用户"),
			Content:  firstNonEmpty(fields["str"], "进入直播间"),
			Level:    atoiSafe(fields["level"]),
			Kind:     string(common.DanmakuEnter),
			At:       at,
		})

	case "pingreq":
		// 服务端心跳请求：必须回 mrkl，否则会被断开。
		_ = writeSTT(conn, "type@=mrkl/")
	}
}

// ------------------------------------------------------------------ STT 协议

// encodeSTT 把一条指令编码成斗鱼弹幕协议包。
//
// 包结构（与旧实现 encode_msg 逐字节一致）：
//
//	u32 LE 长度(=msgLen+9) | u32 LE 长度 | u16 LE 689 | 0x00 | 0x00 | 消息 | 0x00
//
// 注意长度字段**不包含它自己那 4 字节**：所以总字节数 = 长度 + 4。
func encodeSTT(msg string) []byte {
	msgBytes := []byte(msg)
	declared := uint32(len(msgBytes) + 9)

	out := make([]byte, 0, len(msgBytes)+13)
	out = binary.LittleEndian.AppendUint32(out, declared)
	out = binary.LittleEndian.AppendUint32(out, declared)
	out = binary.LittleEndian.AppendUint16(out, 689)
	out = append(out, 0, 0)
	out = append(out, msgBytes...)
	out = append(out, 0)
	return out
}

// writeSTT 编码并发送一条指令。
func writeSTT(conn net.Conn, msg string) error {
	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	_, err := conn.Write(encodeSTT(msg))
	return err
}

// readSTTPacket 从 TCP 流里读出一个完整 STT 包。
//
// 服务端会把多个包连续写在同一连接上，因此必须按长度字段切包，
// 不能假设"一次 Read 就是一个包"（这正是 WebSocket 时代不需要处理的差异）。
func readSTTPacket(r io.Reader) ([]byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, err
	}

	declared := binary.LittleEndian.Uint32(header)
	if declared < 8 || declared > maxPacketSize {
		return nil, fmt.Errorf("弹幕包长度异常: %d", declared)
	}

	rest := make([]byte, declared)
	if _, err := io.ReadFull(r, rest); err != nil {
		return nil, err
	}

	packet := make([]byte, 0, len(rest)+4)
	packet = append(packet, header...)
	packet = append(packet, rest...)
	return packet, nil
}

// parseSTT 解析 "k1@=v1/k2@=v2/" 形式的消息体。
//
// 值里的 @S 代表 '/'、@A 代表 '@'（斗鱼的自定义转义）。
func parseSTT(content string) map[string]string {
	result := make(map[string]string, 16)
	for _, item := range strings.Split(content, "/") {
		if item == "" {
			continue
		}
		key, value, ok := strings.Cut(item, "@=")
		if !ok {
			continue
		}
		value = strings.ReplaceAll(value, "@S", "/")
		value = strings.ReplaceAll(value, "@A", "@")
		result[key] = value
	}
	return result
}

// douyuColColors 是斗鱼弹幕 col 字段对应的颜色。
//
// col 不是"十进制 RGB"，而是**调色板索引**（官方《弹幕服务器接入协议》：
// "col 颜色:默认值 0(表示默认颜色弹幕)"）。表取自斗鱼官方 web 播放器 bundle
// （front-publish/live_player-master/js/h5-plugin_*.js 里的
// `function be(e){switch(+(e||{}).color){case 1:...default:return "#ffffff"}}`），
// 七个取值与官方一一对应。
//
// 之前按十进制 RGB 解析（col=4 → #000004），所以彩色弹幕全显示成黑色。
var douyuColColors = map[int]string{
	1: "#FF2E2E", // 红
	2: "#00CCFF", // 青
	3: "#66FF00", // 草绿
	4: "#FF6600", // 橙
	5: "#CC00FF", // 紫
	6: "#F6447F", // 玫红
	7: "#FF84F6", // 粉
}

// colorFromDouyuCol 把斗鱼 col 字段转成 #RRGGBB。
//
// 空 / 0 / 未知索引一律返回空串，让前端用它配置的默认颜色（白色）——
// 绝不能返回黑色（社区里一个常见实现就踩了这个坑：map 未命中返回 0）。
func colorFromDouyuCol(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return ""
	}
	if c, ok := douyuColColors[n]; ok {
		return c
	}
	// 兜底：调色板只有 1~7，大数值按十进制 RGB 处理（万一上游改回 RGB 语义）
	if n >= 0x10000 && n <= 0xFFFFFF {
		return fmt.Sprintf("#%06X", n)
	}
	return ""
}

func atoiSafe(raw string) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return n
}
