// Package douyu 移植旧项目 DTV-3.0.3/src-tauri/src/platforms/douyu 的全部接口。
//
// 与旧 Rust 实现的对应关系：
//
//	categories.go     ← fetch_douyu_main_categories.rs（m.douyu.com/api/cate/list）
//	livelist.go       ← live_list.rs（目录接口）
//	three_cate.go     ← three_cate.rs（capi getThreeCate）
//	room_info.go      ← fetch_douyu_room_info.rs（betard）
//	search.go         ← search_anchor.rs + 前端 web/src/services/search.ts 的解析规则
//	stream_url.go     ← stream_url.rs（getEncryption + getH5PlayV1）
//	danmaku.go        ← danmu_start.rs（STT 协议）
//
// # 与旧实现的有意差异（都已实测验证，原因写在对应文件里）
//
//  1. 直播列表：旧的 m.douyu.com/hgapi/live/cate/newRecList 已固定返回
//     {"error":1,"msg":"系统异常"}，改用斗鱼 web 站自己在用的
//     gapi/rkc/directory 接口（见 livelist.go）。
//  2. 弹幕传输：旧的 wss://danmuproxy.douyu.com:8506/ 已不再提供 TLS/WebSocket，
//     改用 8601/8602 的明文 TCP + 同一套 STT 报文（见 danmaku.go）。
//  3. 搜索：旧实现把原始 JSON 透传给前端解析，这里把同一套规则下沉到 Go，
//     直接返回前端要的 SearchHit（见 search.go）。
//  4. 取流：旧接口一次只返回一条 URL，这里一次返回全部清晰度档位，
//     因为新播放页需要"同一房间内直接切清晰度"（见 stream_url.go）。
package douyu

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

const (
	// 斗鱼网页端的默认游客 did（仅生成随机 did 失败时兜底）。
	defaultDID = "10000000000000000000000000001501"

	// 默认线路。getH5PlayV1 不指定 cdn 时斗鱼返回一条默认线路。
	defaultCDN = "ws-h5"

	desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
	mobileUA  = "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"

	// 封面/头像在 JSON 里有的是完整 URL、有的只是相对路径，这两个前缀用于补齐。
	coverPrefix  = "https://rpic.douyucdn.cn/"
	avatarPrefix = "https://apic.douyucdn.cn/upload/"

	urlBetard        = "https://www.douyu.com/betard/%s"
	urlGetEncryption = "https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption?did=%s"
	urlGetH5Play     = "https://www.douyu.com/lapi/live/getH5PlayV1/%s"
	urlCateList      = "https://m.douyu.com/api/cate/list"
	urlDirectory     = "https://www.douyu.com/gapi/rkc/directory/%s/%d?limit=%d"
	urlMixList       = "https://www.douyu.com/gapi/rkc/directory/mixListV1/3_%s/%d?limit=%d"
	urlThreeCate     = "https://capi.douyucdn.cn/api/v1/getThreeCate?tag_id=%s&client_sys=android"
	urlSearchUser    = "https://www.douyu.com/japi/search/api/searchUser"
	urlDanmaku       = "wss://danmuproxy.douyu.com:8506/"

	// 页面大小。旧前端固定 20（PAGE_SIZE），这里给网格多几行。
	defaultPageSize = 30
)

// Client 是斗鱼平台的入口，所有接口都挂在它上面。
//
// 无状态，可被多个 Service 方法并发调用；enc 是加密描述符的短期缓存，
// 与 did 绑定（换 did 必须重新取）。
type Client struct {
	http *common.HttpClient

	authMu sync.RWMutex
	did    string
	cookie string // 登录 Cookie（不含 dy_did/acf_did 的覆盖处理，原样保存）

	encMu        sync.Mutex
	enc          *encryptionData
	encFetchedAt time.Time
	encDID       string
}

// NewClient 创建斗鱼客户端。
func NewClient() *Client {
	return &Client{
		http: common.NewHttpClient(),
		did:  generateDeviceID(),
	}
}

// generateDeviceID 生成 32 位十六进制的浏览器 did。
// 与 pure_live 一致：每个进程一个随机 did，而不是固定游客号。
func generateDeviceID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return defaultDID
}

func (c *Client) authDID() string {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.did
}

func (c *Client) authCookie() string {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.cookie
}

// SetCookie 应用登录得到的 Cookie。
//
// 与 pure_live 一致：登录 Cookie 里的 dy_did 必须和签名/请求头一致，
// 否则斗鱼会把登录态当成游客；换 Cookie 必须让加密描述符缓存失效。
func (c *Client) SetCookie(raw string) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSpace(strings.TrimPrefix(raw, "Cookie:"))
	fields := parseCookieFields(raw)

	c.authMu.Lock()
	c.cookie = raw
	if did := fields["dy_did"]; did != "" {
		c.did = did
	} else if did := fields["acf_did"]; did != "" {
		c.did = did
	}
	c.authMu.Unlock()

	c.encMu.Lock()
	c.enc = nil
	c.encFetchedAt = time.Time{}
	c.encDID = ""
	c.encMu.Unlock()

	// 清掉 HTTP 客户端的 cookie jar：登录过程中 passport 会通过 Set-Cookie
	// 下发 dy_auth / acf_auth 等字段，http.Client 会自动把它们加回请求头。
	// 退出登录（raw 为空）时只清 c.cookie 而不清 jar，请求仍会带着旧登录态。
	c.http.ClearCookies()
}

func (c *Client) Cookie() string {
	return c.authCookie()
}

// ---------------------------------------------------------------- Cookie 工具

func parseCookieFields(raw string) map[string]string {
	result := make(map[string]string)
	for _, part := range strings.Split(raw, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		name = strings.TrimSpace(name)
		if !ok || name == "" {
			continue
		}
		result[name] = strings.TrimSpace(value)
	}
	return result
}

func cookieHasLogin(raw string) bool {
	fields := parseCookieFields(raw)
	// H5 会话必须成对出现；只有 acf_auth / acf_jwt_token 其中之一时，
	// 取流接口会直接 403，不能算可用登录。
	h5Session := strings.TrimSpace(fields["acf_auth"]) != "" &&
		strings.TrimSpace(fields["acf_jwt_token"]) != ""
	return h5Session || strings.TrimSpace(fields["dy_auth"]) != ""
}

// cookieUserName 从登录 Cookie 取昵称。
//
// acf_nickname 是展示昵称（可能 URL 编码），acf_username 在部分账号上是 uid，
// 因此优先 nickname，缺失时再退回 username。
func cookieUserName(raw string) string {
	fields := parseCookieFields(raw)
	name := strings.TrimSpace(fields["acf_nickname"])
	if name == "" {
		name = strings.TrimSpace(fields["acf_username"])
	}
	if name == "" {
		return ""
	}
	if decoded, err := url.QueryUnescape(name); err == nil {
		return strings.TrimSpace(decoded)
	}
	return name
}

// fullCookie 返回包含 dy_did/acf_did/LTP0 的完整 Cookie，供 passport 续期使用；
// 播放请求会剔除 LTP0（pure_live 的同一处理，避免边缘节点直接 403）。
func (c *Client) fullCookie() string {
	c.authMu.RLock()
	did, cookie := c.did, c.cookie
	c.authMu.RUnlock()

	fields := parseCookieFields(cookie)
	fields["dy_did"] = did
	fields["acf_did"] = did
	return buildCookieString(fields, []string{"dy_auth", "acf_auth", "acf_jwt_token", "dy_did", "acf_did", "LTP0"})
}

// requestCookie 返回发给斗鱼 www 签名 / 取流接口的 Cookie。
//
// 斗鱼一次登录会同时下发两套会话：
//   - Web 版：dy_auth（不透明 token）
//   - H5 版：acf_auth + acf_jwt_token（JWT）
//
// getEncryption / getH5PlayV1 是 H5 接口：只有 acf_* 这套能被识别并拿到
// 登录后的原画档位（enc_data 里会带 uid）；而把 dy_auth 和 acf_* 混在同一个
// Cookie 里发过去，会被斗鱼边缘直接返回 403「鉴权失败」（没有 API error）。
//
// 因此这里做一次裁剪：
//  1. acf_auth + acf_jwt_token 都在：只发 H5 字段（含全部 acf_*），不发 dy_auth；
//  2. 否则退回 Web dy_auth（或匿名），绝不单发 acf_auth / acf_jwt_token
//     （单独一个同样会 403）。
//
// LTP0 是 passport 续期密钥，只在 RefreshCookie 里使用，不发给业务接口。
func (c *Client) requestCookie(did string) string {
	fields := parseCookieFields(c.authCookie())
	delete(fields, "LTP0")

	h5Session := strings.TrimSpace(fields["acf_auth"]) != "" &&
		strings.TrimSpace(fields["acf_jwt_token"]) != ""

	if h5Session {
		filtered := map[string]string{
			"dy_did":  did,
			"acf_did": did,
		}
		for name, value := range fields {
			if value == "" || name == "dy_did" || name == "acf_did" {
				continue
			}
			// 只保留 H5 账号字段；dy_auth / PHPSESSID 等 Web 字段不参与，
			// 否则会触发上面说的 403。
			if strings.HasPrefix(name, "acf_") {
				filtered[name] = value
			}
		}
		return buildCookieString(filtered, []string{
			"dy_did", "acf_did",
			"acf_auth", "acf_jwt_token",
			"acf_uid", "acf_stk", "acf_username", "acf_nickname",
		})
	}

	filtered := map[string]string{
		"dy_did":  did,
		"acf_did": did,
	}
	if webAuth := strings.TrimSpace(fields["dy_auth"]); webAuth != "" {
		filtered["dy_auth"] = webAuth
	}
	return buildCookieString(filtered, []string{"dy_did", "acf_did", "dy_auth"})
}

func buildCookieString(fields map[string]string, order []string) string {
	parts := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, name := range order {
		if value := fields[name]; value != "" {
			parts = append(parts, name+"="+value)
			seen[name] = true
		}
	}
	rest := make([]string, 0, len(fields))
	for name, value := range fields {
		if seen[name] || value == "" {
			continue
		}
		rest = append(rest, name+"="+value)
	}
	sort.Strings(rest)
	parts = append(parts, rest...)
	return strings.Join(parts, "; ")
}

func refererFor(roomID string) string {
	return "https://www.douyu.com/" + roomID
}

// ---------------------------------------------------------------- JSON 取值工具

// jsonString 把 JSON 里的 string/number 统一取成字符串。
// 斗鱼同一字段在不同接口里类型不一致（room_id 有时是数字有时是字符串）。
func jsonString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(x, 10)
	case int:
		return strconv.Itoa(x)
	case bool:
		return strconv.FormatBool(x)
	default:
		return fmt.Sprintf("%v", x)
	}
}

// jsonInt64 宽松解析整数（容忍 "2.3万" 之外的字符串形式与 JSON 浮点）。
func jsonInt64(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	case string:
		trimmed := strings.TrimSpace(x)
		if trimmed == "" {
			return 0
		}
		if n, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			return n
		}
		// 形如 "101.8万" / "2.3亿" 的人气字符串
		return parseChineseCount(trimmed)
	default:
		return 0
	}
}

// jsonFloat 宽松解析浮点数。
func jsonFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int64:
		return float64(x)
	case int:
		return float64(x)
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return f
		}
		return float64(parseChineseCount(x))
	default:
		return 0
	}
}

// parseChineseCount 解析 "101.8万" / "2.3亿" 这类人气文案。
func parseChineseCount(s string) int64 {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return 0
	}
	multiplier := int64(1)
	switch {
	case strings.Contains(trimmed, "亿"):
		multiplier = 100000000
		trimmed = strings.ReplaceAll(trimmed, "亿", "")
	case strings.Contains(trimmed, "万"):
		multiplier = 10000
		trimmed = strings.ReplaceAll(trimmed, "万", "")
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(trimmed), 64)
	if err != nil {
		return 0
	}
	return int64(math.Round(f * float64(multiplier)))
}

// fullURL 给相对路径补上 CDN 前缀；已是完整 URL 的原样返回。
func fullURL(prefix, raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "//") {
		return "https:" + trimmed
	}
	return prefix + strings.TrimPrefix(trimmed, "/")
}

// douyuAvatarURL 拼出可直接访问的头像地址。
//
// 目录接口里的 av 形如 “avatar_v3/202004/<hash>”，没有扩展名；
// 直接拼 CDN 前缀会 404。正确文件名是 `<hash>_big.jpg`，这里只在
// douyucdn 的 /upload/ 路径且末段没有扩展名时补后缀；
// 已经是完整 URL / 已带后缀的原样返回。
func douyuAvatarURL(raw string) string {
	full := fullURL(avatarPrefix, raw)
	if full == "" {
		return ""
	}
	parsed, err := url.Parse(full)
	if err != nil || !strings.Contains(strings.ToLower(parsed.Hostname()), "douyucdn.cn") {
		return full
	}
	if !strings.Contains(parsed.Path, "/upload/") {
		return full
	}
	name := parsed.Path[strings.LastIndex(parsed.Path, "/")+1:]
	if name == "" || strings.Contains(name, ".") {
		return full
	}
	parsed.Path += "_big.jpg"
	return parsed.String()
}

// isLiveFromFlags 斗鱼"直播中"判定：show_status==1；同时要排除轮播（videoLoop/isLoop）。
//
// 对齐旧项目（web/src/platforms/douyu/followListHelper.ts）：
//   - show_status !== 1 一律视为未开播（2 是"未开播/已结束"，不是直播中）；
//   - show_status == 1 时，video_loop/isLoop == 1 表示轮播（回放），同样不算直播中；
//     video_loop 缺失（0）按直播中处理。
//
// 搜索接口的 isLive(1=直播中，2=未开播) 由 normalizeSearchLive 先归一成
// show_status 语义再传进来。
func isLiveFromFlags(showStatus, isLoop, videoLoop int64) bool {
	if showStatus != 1 {
		return false
	}
	return isLoop != 1 && videoLoop != 1
}
