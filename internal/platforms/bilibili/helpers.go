package bilibili

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// maxResponseBytes 单个响应体的上限，防止上游返回异常大包。
const maxResponseBytes = 12 << 20

// errEmptyBody 上游返回空 body（B 站签名错误时常见）。
var errEmptyBody = fmt.Errorf("上游返回空 body")

// readAll 读取响应体（带上限）。
func readAll(r io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, maxResponseBytes))
}

// unmarshalJSON 解析 JSON。
//
// B 站接口有个通病：`code` 有时是数字有时是字符串、`online` 可能是 "1.2万" 或数字。
// 因此下面所有模型都用能容错的读取函数，而不是把字段直接声明成 int64。
func unmarshalJSON(body []byte, out any) error {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return errEmptyBody
	}
	return json.Unmarshal(trimmed, out)
}

// jsonString 兼容 string / number / bool / null。
func jsonString(v any) string {
	switch value := v.(type) {
	case nil:
		return ""
	case string:
		return value
	case float64:
		return strconv.FormatInt(int64(value), 10)
	case bool:
		if value {
			return "true"
		}
		return "false"
	case json.Number:
		return value.String()
	default:
		return ""
	}
}

// jsonInt 兼容 number / "1.2万" / "123" 这类写法。
func jsonInt(v any) int64 {
	switch value := v.(type) {
	case nil:
		return 0
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	case json.Number:
		if n, err := value.Int64(); err == nil {
			return n
		}
	case string:
		return parseViewerText(value)
	}
	return 0
}

// jsonFloat 兼容 number / string。
func jsonFloat(v any) float64 {
	switch value := v.(type) {
	case nil:
		return 0
	case float64:
		return value
	case int64:
		return float64(value)
	case json.Number:
		if f, err := value.Float64(); err == nil {
			return f
		}
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
			return f
		}
	}
	return 0
}

// jsonBool 兼容 bool / number。
func jsonBool(v any) bool {
	switch value := v.(type) {
	case nil:
		return false
	case bool:
		return value
	case float64:
		return value != 0
	case json.Number:
		f, _ := value.Float64()
		return f != 0
	case string:
		return value == "true" || value == "1"
	}
	return false
}

// parseViewerText 把 "3286" / "1.2万" / "3.5亿" / "10万+" / "1.5w" 解析成整数。
func parseViewerText(text string) int64 {
	s := strings.TrimSpace(text)
	s = strings.TrimSuffix(s, "+")
	if s == "" {
		return 0
	}

	multiplier := int64(1)
	switch {
	case strings.HasSuffix(s, "亿"):
		multiplier = 100000000
		s = strings.TrimSuffix(s, "亿")
	case strings.HasSuffix(s, "万"):
		multiplier = 10000
		s = strings.TrimSuffix(s, "万")
	case strings.HasSuffix(s, "w"), strings.HasSuffix(s, "W"):
		multiplier = 10000
		s = s[:len(s)-1]
	}

	// 去掉千分位与"人"之类的中文后缀
	s = strings.NewReplacer(",", "", "人", "", "次", "", " ", "").Replace(s)
	if s == "" {
		return 0
	}

	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		// 混入中文（例如 "热门"）时放弃
		return 0
	}
	return int64(f * float64(multiplier))
}

// stripEMTags 去掉搜索接口高亮用的 <em class="keyword"> 标签。
func stripEMTags(text string) string {
	if !strings.Contains(text, "<em") {
		return text
	}
	var b strings.Builder
	b.Grow(len(text))
	depth := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '<' {
			if end := strings.IndexByte(text[i:], '>'); end >= 0 {
				depth++
				i += end
				continue
			}
		}
		_ = depth
		b.WriteByte(text[i])
	}
	return b.String()
}

// httpsURL 把封面/头像统一升级到 https。
func httpsURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "//") {
		return "https:" + trimmed
	}
	return enforceHTTPS(trimmed)
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
