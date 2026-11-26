package captcha

import (
	"sync"
	"time"
)

// Gate 人机验证挑战闸门
type Gate struct {
	mu    sync.Mutex
	held  bool            // 闸门是否被占用
	queue []chan struct{} // 等待者队列（按 FIFO 唤醒）

	// onPendingChange 在"是否有挑战正在进行"变化时回调。
	onPendingChange func(pending bool)
}

// NewGate 创建一个闸门
func NewGate() *Gate {
	return &Gate{}
}

// SetPendingCallback 注册"挑战状态变化"回调。
func (g *Gate) SetPendingCallback(cb func(pending bool)) {
	g.mu.Lock()
	g.onPendingChange = cb
	g.mu.Unlock()
}

// notify 通知前端挑战状态变化。
func (g *Gate) notify() {
	g.mu.Lock()
	cb := g.onPendingChange
	g.mu.Unlock()
	if cb != nil {
		cb(g.Pending())
	}
}

// Challenge 进入人机验证挑战状态
//
// 闸门被占时排队等待，最多等 timeout；拿不到就返回 ok=false。
func (g *Gate) Challenge(timeout time.Duration) (release func(), ok bool) {
	g.mu.Lock()
	if !g.held {
		g.held = true
		g.mu.Unlock()
		g.notify()
		return g.releaser(), true
	}

	// 闸门被占时排队等待
	ch := make(chan struct{})
	g.queue = append(g.queue, ch)
	g.mu.Unlock()
	g.notify()

	var timer *time.Timer
	var timeoutCh <-chan time.Time
	if timeout > 0 {
		timer = time.NewTimer(timeout)
		defer timer.Stop()
		timeoutCh = timer.C
	}

	select {
	case <-ch:
		// 拿到闸门
		return g.releaser(), true
	case <-timeoutCh:
		// 超时：把自己从队列里摘掉
		g.mu.Lock()
		select {
		case <-ch:
			g.mu.Unlock()
			return g.releaser(), true
		default:
		}
		// 从等待队列里移除自己。
		for i, c := range g.queue {
			if c == ch {
				g.queue = append(g.queue[:i], g.queue[i+1:]...)
				break
			}
		}
		g.mu.Unlock()
		g.notify()
		return func() {}, false
	}
}

// releaser 返回一个幂等的释放函数
func (g *Gate) releaser() func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			g.held = false
			// 唤醒下一个等待者。
			if len(g.queue) > 0 {
				next := g.queue[0]
				g.queue = g.queue[1:]
				g.held = true
				close(next)
			}
			g.mu.Unlock()
		})
		g.notify()
	}
}

// Held 当前是否有人正在进行人机验证挑战
func (g *Gate) Held() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.held
}

// Pending 当前是否正在进行挑战，或是否有在排队等待挑战
func (g *Gate) Pending() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.held || len(g.queue) > 0
}
