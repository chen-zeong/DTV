package douyin

import (
	"crypto/rand"
	"math"
	"math/big"
	"strconv"
	"strings"
)

// msTokenCharset 是 msToken 的字符集（大小写字母 + 数字）。
const msTokenCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// GenerateMsToken 生成一个 msToken。
//
// 旧实现用的就是"纯随机 107 位字母数字"，抖音服务端不校验其内容，
// 只要存在即可。
func GenerateMsToken(length int) string {
	if length <= 0 {
		length = 107
	}
	out := make([]byte, length)
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		// 极端情况下退化成固定串（仍能跑通，只是不够随机）
		for i := range out {
			out[i] = msTokenCharset[i%len(msTokenCharset)]
		}
		return string(out)
	}
	for i := range out {
		out[i] = msTokenCharset[int(buf[i])%len(msTokenCharset)]
	}
	return string(out)
}

// parseViewerText 把抖音的人数文案换算成数字。
//
// 支持的写法："3286"、"1.2万"、"3.4亿"、"10万+"、"-1"（未知）。
// 解析不出来时返回 0，前端会显示成 0 人，不影响功能。
func parseViewerText(text string) int64 {
	s := strings.TrimSpace(text)
	if s == "" {
		return 0
	}
	// 去掉末尾的 "+"、"人"、"次" 等修饰
	s = strings.TrimSuffix(s, "+")
	s = strings.TrimSuffix(s, "人")
	s = strings.TrimSuffix(s, "次")
	s = strings.TrimSpace(s)

	multiplier := 1.0
	switch {
	case strings.HasSuffix(s, "万"):
		multiplier = 10000
		s = strings.TrimSuffix(s, "万")
	case strings.HasSuffix(s, "亿"):
		multiplier = 100000000
		s = strings.TrimSuffix(s, "亿")
	case strings.HasSuffix(s, "w"), strings.HasSuffix(s, "W"):
		multiplier = 10000
		s = s[:len(s)-1]
	}

	s = strings.TrimSpace(s)
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return int64(math.Round(v * multiplier))
	}
	return 0
}

// randInt63 返回一个非负随机整数（给需要随机数的场景用）。
func randInt63() int64 {
	n, err := rand.Int(rand.Reader, big.NewInt(math.MaxInt64))
	if err != nil {
		return 0
	}
	return n.Int64()
}
