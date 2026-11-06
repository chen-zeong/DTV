package huya

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"dtv/internal/platforms/common"
)

// EmitFunc 与斗鱼一致：平台层不依赖 Wails，由 Service 注入事件回调。
type EmitFunc func(eventName string, payload any)

const (
	// EventDanmakuMessage 全局弹幕事件（payload 为 common.DanmakuEvent）。
	EventDanmakuMessage = "danmaku-message"
	eventDanmakuPrefix  = "danmaku-"

	// urlDanmakuWS 虎牙弹幕 WS 网关（旧实现写死）。
	urlDanmakuWS = "wss://cdnws.api.huya.com"

	heartbeatInterval = 20 * time.Second
	maxBackoff        = 30 * time.Second
	readTimeout       = 90 * time.Second
	dialTimeout       = 15 * time.Second
	maxDanmakuPacket  = 1 << 20
)

// danmakuHeartbeatBytes 是虎牙客户端的心跳包原始字节（旧实现从抓包复制）。
//
// 包体是 TARS 编码的 onlineui.OnUserHeartBeat 请求，自己拼很容易错，因此原样保留。
var danmakuHeartbeatBytes = []byte{
	0x00, 0x03, 0x1d, 0x00, 0x00, 0x69, 0x00, 0x00, 0x00, 0x69, 0x10, 0x03,
	0x2c, 0x3c, 0x4c, 0x56, 0x08, 0x6f, 0x6e, 0x6c, 0x69, 0x6e, 0x65, 0x75,
	0x69, 0x66, 0x0f, 0x4f, 0x6e, 0x55, 0x73, 0x65, 0x72, 0x48, 0x65, 0x61,
	0x72, 0x74, 0x42, 0x65, 0x61, 0x74, 0x7d, 0x00, 0x00, 0x3c, 0x08, 0x00,
	0x01, 0x06, 0x04, 0x74, 0x52, 0x65, 0x71, 0x1d, 0x00, 0x00, 0x2f, 0x0a,
	0x0a, 0x0c, 0x16, 0x00, 0x26, 0x00, 0x36, 0x07, 0x61, 0x64, 0x72, 0x5f,
	0x77, 0x61, 0x70, 0x46, 0x00, 0x0b, 0x12, 0x03, 0xae, 0xf0, 0x0f, 0x22,
	0x03, 0xae, 0xf0, 0x0f, 0x3c, 0x42, 0x6d, 0x52, 0x02, 0x60, 0x5c, 0x60,
	0x01, 0x7c, 0x82, 0x00, 0x0b, 0xb0, 0x1f, 0x9c, 0xac, 0x0b, 0x8c, 0x98,
	0x0c, 0xa8, 0x0c,
}

// DanmakuManager 管理"同一时刻只有一个房间"的虎牙弹幕连接。
type DanmakuManager struct {
	mu      sync.Mutex
	session *danmakuSession
	emit    EmitFunc
	seq     atomic.Uint64
	client  *Client
}

// NewDanmakuManager 创建虎牙弹幕管理器。
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

	log.Printf("[Huya Danmaku] 停止监听 room=%s (request=%s)", current.roomID, roomID)
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
		Platform: string(common.PlatformHuya),
		Message:  message,
	}
	m.emit(EventDanmakuMessage, payload)
	m.emit(eventDanmakuPrefix+roomID, payload)
}

func (m *DanmakuManager) nextMessageID(roomID string, at int64) string {
	return "huya:" + roomID + ":" + strconv.FormatInt(at, 10) + ":" + strconv.FormatUint(m.seq.Add(1), 10)
}

/* ------------------------------------------------------------- 单个连接 */

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
			log.Printf("[Huya Danmaku %s] 等待退出超时", s.roomID)
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
			log.Printf("[Huya Danmaku %s] 已停止监听", s.roomID)
			return
		}
		if err != nil {
			log.Printf("[Huya Danmaku %s] 连接断开: %v，%s 后重连", s.roomID, err, backoff)
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

// connectAndRead 建立一次 WS 连接并读到断开。
func (s *danmakuSession) connectAndRead(ctx context.Context) error {
	// 注册包需要 ayyuid（主播 UID），从房间档案里取
	regPayload, err := s.buildRegPayload()
	if err != nil {
		return err
	}

	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	conn, _, err := websocket.Dial(dialCtx, urlDanmakuWS, nil)
	cancel()
	if err != nil {
		return fmt.Errorf("连接虎牙弹幕失败: %w", err)
	}
	s.setConn(conn)
	defer func() {
		s.clearConn(conn)
		_ = conn.CloseNow()
	}()

	conn.SetReadLimit(maxDanmakuPacket)

	if err := conn.Write(ctx, websocket.MessageBinary, regPayload); err != nil {
		return fmt.Errorf("发送注册包失败: %w", err)
	}

	// 心跳协程
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
				if err := conn.Write(hbCtx, websocket.MessageBinary, danmakuHeartbeatBytes); err != nil {
					return
				}
			}
		}
	}()

	// 读循环
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
		s.handleMessage(data)
	}
}

// buildRegPayload 组装 WS 注册包。
//
// 结构（旧 get_ws_info_tars）：
//
//	oos   = [list<string>(tag0) 订阅主题, string(tag1) 空串]
//	wscmd = [int32(tag0)=16, bytes(tag1)=oos]
//
// 主题固定两条：live:<uid> 与 chat:<uid>。
//
// ⚠️ 与旧实现的重要差异：旧代码用 profileInfo.yyid 当订阅 UID，
// 实测那个值订阅不到聊天（12 秒只收到 1 个控制包）；真正的订阅 UID 是
// **频道 ID**（liveData.channel / baseSteamInfoList[0].lChannelId），
// 用它 12 秒能收到几十条聊天。因此这里优先取频道 ID。
func (s *danmakuSession) buildRegPayload() ([]byte, error) {
	data, err := s.manager.client.fetchProfile(s.roomID)
	if err != nil {
		return nil, err
	}

	ayyuid := int64(0)
	if data.Stream != nil && len(data.Stream.BaseStreamInfoList) > 0 {
		ayyuid = int64(data.Stream.BaseStreamInfoList[0].ChannelID)
	}
	if ayyuid == 0 {
		ayyuid = data.LiveData.Channel
	}
	if ayyuid == 0 {
		ayyuid = data.LiveData.UID
	}
	if ayyuid == 0 {
		ayyuid = data.ProfileInfo.Yyid
	}
	if ayyuid == 0 {
		// 最后兜底：用房间号（与旧实现一致）
		ayyuid, _ = strconv.ParseInt(s.roomID, 10, 64)
	}
	if ayyuid == 0 {
		return nil, fmt.Errorf("无法确定虎牙频道 ID（房间 %s）", s.roomID)
	}
	debugLog("订阅 UID=%d", ayyuid)

	topics := []string{
		"live:" + strconv.FormatInt(ayyuid, 10),
		"chat:" + strconv.FormatInt(ayyuid, 10),
	}

	oos := newTarsWriter()
	oos.writeStringList(0, topics)
	oos.writeString(1, "")

	wscmd := newTarsWriter()
	wscmd.writeInt32(0, 16)
	wscmd.writeBytes(1, oos.bytes())

	return wscmd.bytes(), nil
}

// handleMessage 解析一条 WS 消息，聊天弹幕推给前端。
//
// 消息结构（旧 decode_msg_tars）：
//
//	外层: int32(tag0)=7, bytes(tag1)
//	  内层: int32(tag1)=1400 表示聊天, bytes(tag2)
//	    载荷: struct(tag0)=HuyaUser, string(tag3)=内容, struct(tag6)=颜色
func (s *danmakuSession) handleMessage(data []byte) {
	// 外层
	outer := newTarsReader(data)
	outerType := outer.readInt32Tag(0, -1)
	if outerType != 7 {
		debugLog("外层 type=%d（非 7，忽略）", outerType)
		return
	}
	b1, err := outer.readBytesTag(1)
	if err != nil {
		debugLog("读外层 bytes 失败: %v", err)
		return
	}

	// 内层
	inner := newTarsReader(b1)
	nested := inner.readInt32Tag(1, -1)
	b2, err := inner.readBytesTag(2)
	if err != nil {
		debugLog("读内层 bytes 失败(nested=%d): %v", nested, err)
		return
	}
	if nested != 1400 {
		// 非聊天消息（礼物/进场等），忽略
		debugLog("非聊天消息 nested=%d，跳过", nested)
		return
	}

	// 载荷
	payload := newTarsReader(b2)
	nickname := ""
	if err := payload.readStructBegin(0); err == nil {
		// HuyaUser：tag0=uid、tag1=imid、tag2=昵称、tag3=性别
		//
		// ⚠️ tag3 必须读掉（即使不用），否则结构体里的 tag3 会把
		// 后面正文的 tag3（聊天内容）抢走，导致正文永远解析为空。
		_ = payload.readInt64Tag(0, -1)
		_ = payload.readInt64Tag(1, -1)
		nickname = payload.readStringTag(2, "")
		_ = payload.readInt32Tag(3, -1)
	}
	text := payload.readStringTag(3, "")
	color := int32(16777215)
	if err := payload.readStructBegin(6); err == nil {
		color = payload.readInt32Tag(0, 16777215)
	}

	if strings.TrimSpace(text) == "" {
		debugLog("聊天消息内容为空，跳过")
		return
	}
	if nickname == "" {
		nickname = "匿名"
	}

	at := time.Now().UnixMilli()
	s.manager.emitEvent(s.roomID, common.DanmakuMessage{
		ID:       s.manager.nextMessageID(s.roomID, at),
		Nickname: nickname,
		Content:  text,
		Level:    0, // 虎牙这条链路里拿不到等级，旧实现也填 0
		Color:    colorHex(color),
		Kind:     string(common.DanmakuChat),
		At:       at,
	})
}

// colorHex 把十进制颜色转 #RRGGBB（<=0 时视为默认白色）。
func colorHex(color int32) string {
	if color <= 0 {
		return "#FFFFFF"
	}
	if color > 0xFFFFFF {
		color &= 0xFFFFFF
	}
	return fmt.Sprintf("#%06X", color)
}

// debugEnabled 由环境变量 DTV_DANMAKU_DEBUG 控制（排查解码问题用）。
var debugEnabled = os.Getenv("DTV_DANMAKU_DEBUG") != ""

func debugLog(format string, args ...any) {
	if debugEnabled {
		log.Printf("[Huya Danmaku][debug] "+format, args...)
	}
}
