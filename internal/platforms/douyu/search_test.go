package douyu

import "testing"

// 斗鱼搜索接口的 isLive 语义容易写反：实测在线房间是 1，离线房间是 2。
// 这里锁死归一化规则，防止以后又按“2=直播中”改回去。
func TestNormalizeSearchLive(t *testing.T) {
	cases := map[int64]int64{
		1: 1, // 直播中
		2: 0, // 未开播
		0: 0, // 缺失
		3: 0, // 未知值一律按未开播
	}
	for raw, want := range cases {
		if got := normalizeSearchLive(raw); got != want {
			t.Errorf("normalizeSearchLive(%d) = %d，期望 %d", raw, got, want)
		}
	}
}
