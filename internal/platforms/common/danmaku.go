package common

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// EventDanmakuMessage 全局弹幕事件名（所有平台统一）。
	EventDanmakuMessage = "danmaku-message"
	// eventDanmakuPrefix 按房间的事件名前缀：danmaku-<roomId>。
	eventDanmakuPrefix = "danmaku-"

	danmakuStopTimeout = 3 * time.Second
)

// DanmakuEmitFunc 是平台层向外发弹幕事件的抽象，脱离 Wails 运行时以便单测。
type DanmakuEmitFunc func(eventName string, payload any)

type danmakuLease struct {
	token    uint64
	platform LivePlatform
	roomID   string
	stop     func()
}

// DanmakuHub 是跨所有平台的全局弹幕协调器。
//
// 业务规则要求「同一时刻只监听一个直播间」：无论是同平台切房间还是跨平台
// 切换（如从斗鱼切到 B 站），新会话启动时都会自动停掉旧会话，并阻止迟到的
// 旧平台 Stop 请求误杀新会话。
type DanmakuHub struct {
	mu        sync.Mutex
	nextToken uint64
	active    *danmakuLease
}

// NewDanmakuHub 创建一个跨平台弹幕协调器。
func NewDanmakuHub() *DanmakuHub {
	return &DanmakuHub{}
}

// Acquire 抢占全局唯一监听槽位：如有旧会话（任意平台）则先同步停止。
func (h *DanmakuHub) Acquire(platform LivePlatform, roomID string, stop func()) uint64 {
	h.mu.Lock()
	prev := h.active
	h.nextToken++
	token := h.nextToken
	h.active = &danmakuLease{
		token:    token,
		platform: platform,
		roomID:   roomID,
		stop:     stop,
	}
	h.mu.Unlock()

	if prev != nil && prev.stop != nil {
		prev.stop()
	}
	return token
}

// Stop 停止当前会话；指定 platform/roomID 时仅在完全匹配时才停止，避免切房间竞态误杀。
func (h *DanmakuHub) Stop(platform LivePlatform, roomID string) {
	trimmed := strings.TrimSpace(roomID)

	h.mu.Lock()
	current := h.active
	if current == nil {
		h.mu.Unlock()
		return
	}
	if platform != "" && current.platform != platform {
		h.mu.Unlock()
		return
	}
	if trimmed != "" && current.roomID != trimmed {
		h.mu.Unlock()
		return
	}
	h.active = nil
	h.mu.Unlock()

	if current.stop != nil {
		current.stop()
	}
}

// StopAll 无条件停止当前活跃的任意平台会话。
func (h *DanmakuHub) StopAll() {
	h.Stop("", "")
}

// RunningRoom 返回指定平台当前正在监听的房间号；platform 为空时返回任意活跃房间。
func (h *DanmakuHub) RunningRoom(platform LivePlatform) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.active == nil {
		return ""
	}
	if platform != "" && h.active.platform != platform {
		return ""
	}
	return h.active.roomID
}

// DanmakuController 封装单个平台的弹幕会话启停、消息 ID 生成与事件推送。
type DanmakuController struct {
	platform LivePlatform
	emit     DanmakuEmitFunc
	hub      *DanmakuHub
	seq      atomic.Uint64
}

// NewDanmakuController 构建平台弹幕控制器；hub 为空时创建独立 hub（便于单测）。
func NewDanmakuController(platform LivePlatform, emit DanmakuEmitFunc, hub *DanmakuHub) *DanmakuController {
	if hub == nil {
		hub = NewDanmakuHub()
	}
	return &DanmakuController{
		platform: platform,
		emit:     emit,
		hub:      hub,
	}
}

// Start 启动新房间的监听会话，并自动停掉全局上一次会话（含其它平台）。
func (c *DanmakuController) Start(
	roomID string,
	run func(ctx context.Context),
	onStop func(),
) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var once sync.Once

	stop := func() {
		cancel()
		if onStop != nil {
			onStop()
		}
		once.Do(func() {
			select {
			case <-done:
			case <-time.After(danmakuStopTimeout):
				log.Printf("[%s Danmaku %s] 等待退出超时", c.platform, roomID)
			}
		})
	}

	c.hub.Acquire(c.platform, roomID, stop)

	go func() {
		defer close(done)
		run(ctx)
	}()
}

// Stop 停止当前平台（或指定房间）的弹幕会话。
func (c *DanmakuController) Stop(roomID string) {
	c.hub.Stop(c.platform, roomID)
}

// StopAll 停止当前平台的活跃会话（应用退出时调用）。
func (c *DanmakuController) StopAll() {
	c.hub.Stop(c.platform, "")
}

// RunningRoom 返回当前平台正在监听的房间号（空表示未监听或已切到其它平台）。
func (c *DanmakuController) RunningRoom() string {
	return c.hub.RunningRoom(c.platform)
}

// NextMessageID 生成递增且全局唯一的弹幕 ID。
func (c *DanmakuController) NextMessageID(roomID string, at int64) string {
	return string(c.platform) + ":" + roomID + ":" +
		strconv.FormatInt(at, 10) + ":" +
		strconv.FormatUint(c.seq.Add(1), 10)
}

// Emit 补齐缺省字段并向事件总线推送弹幕。
func (c *DanmakuController) Emit(roomID string, msg DanmakuMessage, includeRoomEvent bool) {
	if c.emit == nil {
		return
	}
	if msg.At == 0 {
		msg.At = time.Now().UnixMilli()
	}
	if msg.ID == "" {
		msg.ID = c.NextMessageID(roomID, msg.At)
	}
	if msg.Kind == "" {
		msg.Kind = string(DanmakuChat)
	}
	payload := DanmakuEvent{
		RoomID:   roomID,
		Platform: string(c.platform),
		Message:  msg,
	}
	c.emit(EventDanmakuMessage, payload)
	if includeRoomEvent {
		c.emit(eventDanmakuPrefix+roomID, payload)
	}
}

// RunDanmakuLoop 统一的断线重连主循环：指数退避并在稳定运行后重置退避。
func RunDanmakuLoop(
	ctx context.Context,
	logTag string,
	stableAfter time.Duration,
	maxBackoff time.Duration,
	connectAndRead func(context.Context) error,
) {
	if stableAfter <= 0 {
		stableAfter = 10 * time.Second
	}
	if maxBackoff <= 0 {
		maxBackoff = 30 * time.Second
	}

	backoff := time.Second
	for {
		started := time.Now()
		err := connectAndRead(ctx)
		if ctx.Err() != nil {
			log.Printf("[%s] 已停止监听", logTag)
			return
		}
		if err != nil {
			log.Printf("[%s] 连接断开: %v，%s 后重连", logTag, err, backoff)
		}

		if time.Since(started) >= stableAfter {
			backoff = time.Second
		}

		select {
		case <-ctx.Done():
			log.Printf("[%s] 已停止监听", logTag)
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
