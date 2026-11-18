package captcha

import (
	"sync"
	"time"
)

// Gate 人机验证挑战闸门
type Gate struct {
	mu    sync.Mutex
	held  bool            // 闸门是否被占用
	owner string          // 当前持有者（直播间号，便于日志排查）
	queue []chan struct{} // 等待者队列（按 FIFO 唤醒）
}

// NewGate 创建一个闸门
func NewGate() *Gate {
	return &Gate{}
}

// Challenge 进入人机验证挑战状态
func (g *Gate) Challenge(owner string, timeout time.Duration) (release func(), ok bool) {
	g.mu.Lock()
	if !g.held {
		g.held = true
		g.owner = owner
		g.mu.Unlock()
		return g.releaser(), true
	}

	// 闸门被占时排队等待
	ch := make(chan struct{})
	g.queue = append(g.queue, ch)
	g.mu.Unlock()

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
			g.owner = ""
			// 唤醒下一个等待者。
			if len(g.queue) > 0 {
				next := g.queue[0]
				g.queue = g.queue[1:]
				g.held = true
				g.owner = ""
				close(next)
			}
			g.mu.Unlock()
		})
	}
}

// Held 当前是否有人正在进行人机验证挑战
func (g *Gate) Held() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.held
}

// Owner 当前持有闸门的直播间号，为空时没有挑战
func (g *Gate) Owner() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.owner
}

// Pending 当前是否正在进行挑战，或是否有在排队等待挑战
func (g *Gate) Pending() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.held || len(g.queue) > 0
}
