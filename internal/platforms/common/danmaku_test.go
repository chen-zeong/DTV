package common

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestDanmakuHubCrossPlatformPreemptionAndSafeStop(t *testing.T) {
	hub := NewDanmakuHub()
	douyuCtrl := NewDanmakuController(PlatformDouyu, nil, hub)
	biliCtrl := NewDanmakuController(PlatformBilibili, nil, hub)

	var douyuStopped atomic.Bool
	douyuCtrl.Start("1001", func(ctx context.Context) {
		<-ctx.Done()
		douyuStopped.Store(true)
	}, nil)

	if got := douyuCtrl.RunningRoom(); got != "1001" {
		t.Fatalf("expected douyu running room 1001, got %q", got)
	}

	// 切到 B 站时，共享 Hub 必须自动停掉斗鱼会话。
	var biliStopped atomic.Bool
	biliCtrl.Start("2002", func(ctx context.Context) {
		<-ctx.Done()
		biliStopped.Store(true)
	}, nil)

	if !douyuStopped.Load() {
		t.Fatal("expected douyu session to be stopped when bilibili session started")
	}
	if got := douyuCtrl.RunningRoom(); got != "" {
		t.Fatalf("expected douyu running room cleared, got %q", got)
	}
	if got := biliCtrl.RunningRoom(); got != "2002" {
		t.Fatalf("expected bilibili running room 2002, got %q", got)
	}

	// 斗鱼迟到的 Stop 不应误杀 B 站当前监听。
	douyuCtrl.Stop("1001")
	douyuCtrl.StopAll()
	if biliStopped.Load() || biliCtrl.RunningRoom() != "2002" {
		t.Fatal("late stop from another platform must not stop active bilibili session")
	}

	// 房间号不匹配的 Stop 也不应误杀当前房间。
	biliCtrl.Stop("9999")
	if biliStopped.Load() || biliCtrl.RunningRoom() != "2002" {
		t.Fatal("mismatched roomId stop must not stop active room")
	}

	biliCtrl.Stop("2002")
	if !biliStopped.Load() || biliCtrl.RunningRoom() != "" {
		t.Fatal("expected matching stop to stop bilibili session")
	}
}

func TestDanmakuControllerEmitAndID(t *testing.T) {
	var events []DanmakuEvent
	ctrl := NewDanmakuController(PlatformHuya, func(name string, payload any) {
		if name == EventDanmakuMessage {
			events = append(events, payload.(DanmakuEvent))
		}
	}, nil)

	ctrl.Emit("888", DanmakuMessage{
		Nickname: "alice",
		Content:  "hi",
		At:       1000,
	}, true)

	if len(events) != 1 {
		t.Fatalf("expected 1 global event, got %d", len(events))
	}
	if events[0].Platform != string(PlatformHuya) || events[0].RoomID != "888" {
		t.Fatalf("unexpected event metadata: %+v", events[0])
	}
	if events[0].Message.ID != "huya:888:1000:1" || events[0].Message.Kind != string(DanmakuChat) {
		t.Fatalf("unexpected message defaults: %+v", events[0].Message)
	}
}

func TestRunDanmakuLoopStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls atomic.Int32
	done := make(chan struct{})

	go func() {
		defer close(done)
		RunDanmakuLoop(ctx, "test", 50*time.Millisecond, 100*time.Millisecond, func(c context.Context) error {
			calls.Add(1)
			cancel()
			return context.Canceled
		})
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("RunDanmakuLoop did not exit promptly after context cancel")
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 attempt, got %d", calls.Load())
	}
}
