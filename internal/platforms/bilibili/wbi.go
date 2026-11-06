package bilibili

import (
	"crypto/md5"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// B 站有两套签名，别混用：
//
//  1. 「直播列表」用固定密钥的 md5 签名（second/getList 的 w_rid）：
//     把参数按固定顺序拼成 "k=v&k=v" 再接上 secret，取 md5。
//     参数里必须同时带 w_webid 与 wts，且 **wts 就是参与签名的那个值**
//     （时间戳不一致会直接 -352）。
//
//  2. 「房间信息 / 弹幕服务器」用 WBI 签名（getInfoByRoom、getDanmuInfo 的 w_rid）：
//     nav 接口下发 img_key/sub_key，按 MIXIN_KEY_ENC_TAB 重排出 32 位 mixin_key，
//     参数按 key 升序、值做 url 编码后拼串，再接 mixin_key 取 md5。
//
// 两套 secret/mixin 完全不同，写错就只会拿到 -352 或 -352 之外的静默空数据。

// listSignSecret 是直播列表 md5 签名的固定密钥（前端 chunk 里硬编码的同一个值）。
const listSignSecret = "ea1db124af3c7062474693fa704f4ff8"

// mixinKeyEncTab 是 WBI 的字段重排表。
var mixinKeyEncTab = [64]int{
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
	27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
	37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
	22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
}

// md5Hex 返回小写 32 位 md5。
func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// signedPairs 把 (key,value) 按 key 升序排序。
func signedPairs(params [][2]string) [][2]string {
	out := make([]string, 0, len(params))
	_ = out
	sorted := make([][2]string, len(params))
	copy(sorted, params)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i][0] < sorted[j][0] })
	return sorted
}

// listSignQuery 生成直播列表的签名 query（含 w_rid）。
//
// 注意：这里的值 **不做 url 转义**，与旧实现一致（参数值全是数字/固定串，
// 加了转义反而会让签名和线上不一致）。
func listSignQuery(params [][2]string, wts int64) (string, string) {
	pairs := make([][2]string, 0, len(params)+1)
	pairs = append(pairs, params...)
	pairs = append(pairs, [2]string{"wts", strconv.FormatInt(wts, 10)})

	parts := make([]string, 0, len(pairs))
	for _, kv := range pairs {
		parts = append(parts, kv[0]+"="+kv[1])
	}
	query := strings.Join(parts, "&")
	return query, md5Hex(query + listSignSecret)
}

// mixinKey 由 img_key+sub_key 重排出 32 位 mixin_key。
func mixinKey(imgKey, subKey string) string {
	orig := imgKey + subKey
	var b strings.Builder
	for _, idx := range mixinKeyEncTab {
		if idx < len(orig) {
			b.WriteByte(orig[idx])
		}
	}
	key := b.String()
	if len(key) > 32 {
		key = key[:32]
	}
	return key
}

// wbiEncodeValue 按 WBI 规范对值做转义。
//
// 与标准 url.QueryEscape 的差别：`!'()*` 必须被丢弃而不是转义，
// 空格要编码成 %20（QueryEscape 会给 `+`）。
func wbiEncodeValue(s string) string {
	const banned = "!'()*"

	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case strings.IndexByte(banned, c) >= 0:
			// 丢弃
		default:
			b.WriteString("%")
			b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return b.String()
}

// wbiSignedQuery 生成 WBI 签名 query（含 wts 与 w_rid）。
func wbiSignedQuery(params [][2]string, imgKey, subKey string, wts int64) string {
	pairs := make([][2]string, 0, len(params)+1)
	pairs = append(pairs, params...)
	pairs = append(pairs, [2]string{"wts", strconv.FormatInt(wts, 10)})
	pairs = signedPairs(pairs)

	parts := make([]string, 0, len(pairs))
	for _, kv := range pairs {
		parts = append(parts, wbiEncodeValue(kv[0])+"="+wbiEncodeValue(kv[1]))
	}
	query := strings.Join(parts, "&")
	return query + "&w_rid=" + md5Hex(query+mixinKey(imgKey, subKey))
}

// nowSeconds 便于测试注入。
var nowSeconds = func() int64 { return time.Now().Unix() }

// buildURL 把 query 附加到 endpoint。
func buildURL(endpoint, query string) string {
	if query == "" {
		return endpoint
	}
	return endpoint + "?" + query
}

// queryEscape 用于少数需要标准转义的场景（搜索关键词）。
func queryEscape(s string) string { return url.QueryEscape(s) }
