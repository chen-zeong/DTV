//go:build windows

package windowfix

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

func TestAdjustMaximisedClientRect(t *testing.T) {
	monitor := w32.RECT{Left: 0, Top: 0, Right: 1920, Bottom: 1080}

	t.Run("non-autohide workarea stays untouched", func(t *testing.T) {
		client := w32.RECT{Left: 0, Top: 0, Right: 1920, Bottom: 1040}
		AdjustMaximisedClientRect(&client, monitor, [4]bool{})
		want := w32.RECT{Left: 0, Top: 0, Right: 1920, Bottom: 1040}
		if client != want {
			t.Fatalf("got %+v, want %+v", client, want)
		}
	})

	t.Run("left autohide taskbar insets left edge by 1px", func(t *testing.T) {
		client := monitor
		AdjustMaximisedClientRect(&client, monitor, [4]bool{true, false, false, false})
		want := w32.RECT{Left: 1, Top: 0, Right: 1920, Bottom: 1080}
		if client != want {
			t.Fatalf("got %+v, want %+v", client, want)
		}
	})

	t.Run("bottom autohide taskbar insets bottom edge by 1px", func(t *testing.T) {
		client := monitor
		AdjustMaximisedClientRect(&client, monitor, [4]bool{false, false, false, true})
		want := w32.RECT{Left: 0, Top: 0, Right: 1920, Bottom: 1079}
		if client != want {
			t.Fatalf("got %+v, want %+v", client, want)
		}
	})

	t.Run("exact fullscreen fallback insets right and bottom by 1px", func(t *testing.T) {
		client := monitor
		AdjustMaximisedClientRect(&client, monitor, [4]bool{})
		want := w32.RECT{Left: 0, Top: 0, Right: 1919, Bottom: 1079}
		if client != want {
			t.Fatalf("got %+v, want %+v", client, want)
		}
	})
}
