package huya

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// stdBase64 标准 base64（anti-code 的 fm 字段用它解码）。
var stdBase64 = base64.StdEncoding

// newPostRequest 构造一个 POST 请求（body 为原始字节）。
func newPostRequest(target string, body []byte) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodPost, target, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	return req, nil
}

// readAllLimited 读取最多 limit 字节（防止异常响应把内存打爆）。
func readAllLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit))
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}
	return data, nil
}

// truncate 截断字符串，用于错误信息里带一小段响应体。
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
