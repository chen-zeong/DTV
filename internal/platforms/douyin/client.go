package douyin

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

// 抖音接口的几个固定常量（旧实现全部写死，改任何一个签名都会对不上）。
const (
	// desktopUA 必须与实际请求头一致 —— a_bogus 的 UA 参与哈希。
	desktopUA = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) " +
		"Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400"

	referer        = "https://live.douyin.com/"
	urlRoomEnter   = "https://live.douyin.com/webcast/room/web/enter/"
	urlPartitionV2 = "https://live.douyin.com/webcast/web/partition/detail/room/v2/"
	urlLiveHome    = "https://live.douyin.com/"

	// aid 与 live_id 是 web 端的固定值，同时参与 a_bogus 的主表。
	paramAid    = "6383"
	paramLiveID = "1"
)

// Client 是抖音 HTTP 客户端。
//
// 与旧实现的一处关键差异：旧代码把 ttwid / odin_tt 硬编码在源码里，
// 那些 cookie 过一段时间就失效（失效后接口全部返回空）。
// 这里改成"先访问一次直播首页，让 cookie jar 自动收下 ttwid 等 cookie"，
// 之后的所有请求都自动带上 —— 无需手工抄 cookie。
type Client struct {
	http *common.HttpClient

	mu       sync.Mutex
	warmedAt time.Time
	warmErr  error

	// roomIDs 缓存 webRID → 内部 roomId。
	//
	roomIDs map[string]string

	// offlineCache 缓存 webRID → 未开播记录。
	//
	// 蓝V/官方认证直播间未开播时，直播间页正常加载但内嵌 JSON 里没有
	// roomId。验证码窗口里的脚本检测到这种情况会回传 offline 信号，
	// 记录下来，避免下次再弹一次验证码窗口。
	// 超过 offlineTrustTTL 之后必须重新验证，否则蓝V直播间中途开播会被
	// 误判成"未开播"直到缓存过期。
	offlineCache map[string]time.Time

	// captchaResolver 由宿主注入
	//
	// 当直播间页被验证码拦截时，弹窗让用户在真实 WebView 里过验证码，
	// 拿到内部 roomId 后回传
	captchaResolver CaptchaResolver

	// roomIDResolver 由宿主注入
	//
	// 解析 web_rid → 内部 roomId 且不弹窗，宿主侧用常驻 WebView 实现
	// （浏览器会话级放行），供批量刷新场景用。
	roomIDResolver RoomIDResolver
}

// SetRoomIDResolver 注入不弹窗的 roomId 解析器
func (c *Client) SetRoomIDResolver(resolver RoomIDResolver) {
	c.roomIDResolver = resolver
}

// CaptchaResolver 解决抖音直播间页的验证码拦截。
//
// 平台层不依赖 Wails，由 Service/main 层注入实现。
// 入参 webRID ；返回内部 roomId；失败返回错误
type CaptchaResolver func(webRID string) (string, error)

// RoomIDResolver 解析 web_rid → 内部 roomId
//
// 与 CaptchaResolver 的区别:
//   - CaptchaResolver：被拦时弹原生窗口让用户手动过验证码，适合用户主动
//     进直播间（播放页 / 搜索）这种单次操作；
//   - RoomIDResolver：复用同一个常驻 WebView（浏览器会话）导航到目标
//     直播间页并从 DOM 里取 roomId。抖音的验证码是 IP 放行，用户过完
//     一次之后，这个 WebView 就不再被拦截
type RoomIDResolver func(webRID string) (string, error)

// ErrCaptchaOffline 表示直播间页面正常加载但拿不到内部 roomId —— 蓝V/官方
// 认证直播间未开播时的特征为页面内嵌 JSON 里根本没有 roomId
// 主包的验证码脚本检测到这种情况回传哨兵值，resolveRoom 把它转成
// 明确的"未开播"错误，而不是挂着验证码窗口白等到超时。
var ErrCaptchaOffline = errors.New("直播间未开播或已结束")

// ErrRoomOffline 表示"确认主播当前未开播"
var ErrRoomOffline = errors.New("主播当前未开播或直播已结束")

// SetCaptchaResolver 注入验证码解决器
func (c *Client) SetCaptchaResolver(resolver CaptchaResolver) {
	c.captchaResolver = resolver
}

// NewClient 创建抖音客户端。
//
// 首页 cookie 预热（换 ttwid）只放到后台跑：它是 1.5~2s 的一次性开销，
// 挡在列表请求前面会让"第一次进抖音分区"慢上三四秒（旧实现用硬编码
// cookie，所以从来没有这笔开销）。实测列表接口不带 cookie 也能正常返回，
// 预热只是为了拿到 ttwid 并顺手把 TLS 连接暖起来，绝不该阻塞首屏。
func NewClient() *Client {
	c := &Client{
		http:         common.NewHttpClient(),
		roomIDs:      make(map[string]string),
		offlineCache: make(map[string]time.Time),
	}
	go func() { _ = c.warmup() }()
	return c
}

// offlineTrustTTL 获取到直播间"未开播"状态后直接复用的时长
// 这段时间内，如果用户再次访问该直播间，直接返回"未开播"状态
const offlineTrustTTL = 60 * time.Second

// captchaPassWindow 一次验证码通过后的放行有效期。
//
// 抖音的验证码过了一次之后，同一会话访问任意直播间都不会再被拦截
const captchaPassWindow = 30 * time.Minute

var (
	captchaPassMu sync.Mutex
	captchaPassAt time.Time
)

// CaptchaRecentlyPassed 放行有效期内是否已有验证码通过
func CaptchaRecentlyPassed() bool {
	captchaPassMu.Lock()
	defer captchaPassMu.Unlock()
	return !captchaPassAt.IsZero() && time.Since(captchaPassAt) < captchaPassWindow
}

// MarkCaptchaPassed 记录一次验证码通过
func MarkCaptchaPassed() {
	captchaPassMu.Lock()
	captchaPassAt = time.Now()
	captchaPassMu.Unlock()
}

// ResetCaptchaPassed 作废放行状态。
//
// 常驻浏览器窗口被销毁时调用: 那个 WebView 里的放行 cookie 随窗口一起没了。
func ResetCaptchaPassed() {
	captchaPassMu.Lock()
	captchaPassAt = time.Time{}
	captchaPassMu.Unlock()
}

// cacheRoomID 记录 webRID → 内部 roomId 供取流/弹幕复用
func (c *Client) cacheRoomID(webRID, internalID string) {
	if webRID == "" || internalID == "" {
		return
	}
	c.mu.Lock()
	c.roomIDs[webRID] = internalID
	c.mu.Unlock()
}

// lookupRoomID 查缓存里的内部 roomId
func (c *Client) lookupRoomID(webRID string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.roomIDs[webRID]
}

// forgetRoomID 当 id 失效时从缓存里删掉某个映射
func (c *Client) forgetRoomID(webRID string) {
	c.mu.Lock()
	delete(c.roomIDs, webRID)
	c.mu.Unlock()
}

// cacheOffline 记录 webRID 已确认未开播。
//
// 只记结论的新鲜度 (at): 是否要弹验证码窗口由 CaptchaRecentlyPassed
// 这个设备级状态判断，两者生命周期不同。
func (c *Client) cacheOffline(webRID string) {
	if webRID == "" {
		return
	}
	c.mu.Lock()
	c.offlineCache[webRID] = time.Now()
	c.mu.Unlock()
}

// isCachedOffline 返回该直播间的"未开播"结论是否可直接复用。
//
// 只看结论是否还在 offlineTrustTTL 内；是否要弹验证码窗口由
// CaptchaRecentlyPassed 单独判断。
func (c *Client) isCachedOffline(webRID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	at, ok := c.offlineCache[webRID]
	if !ok {
		return false
	}
	if time.Since(at) > offlineTrustTTL {
		return false
	}
	return true
}

// clearOffline 让某个直播间的"未开播"结论失效，之后将重新请求该直播间。
func (c *Client) clearOffline(webRID string) {
	if webRID == "" {
		return
	}
	c.mu.Lock()
	delete(c.offlineCache, webRID)
	c.mu.Unlock()
}

// warmup 访问一次直播首页以获取 cookie（ttwid 等）。
//
// 结果缓存 30 分钟，避免每次请求都多打一次页面。
func (c *Client) warmup() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.warmedAt.IsZero() && time.Since(c.warmedAt) < 30*time.Minute {
		return c.warmErr
	}

	headers := map[string]string{
		"User-Agent":      desktopUA,
		"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "zh-CN,zh;q=0.9",
	}
	resp, err := c.http.Get(urlLiveHome, headers)
	if err != nil {
		c.warmedAt = time.Time{}
		c.warmErr = fmt.Errorf("抖音首页 cookie 获取失败: %w", err)
		return c.warmErr
	}
	// 只需要响应头里的 Set-Cookie（jar 已经收下了），正文读完即丢。
	// 必须把 body 读干净再关：只读一半就 close，Go 的 transport 会认为这条
	// 连接不可复用而直接丢弃，后面的列表请求又得重新做一次 TLS 握手
	// （实测冷连接 760ms vs 复用 130ms）。
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	c.warmedAt = time.Now()
	c.warmErr = nil
	return nil
}

// signedURL 用固定顺序拼 query、签名，再拼成最终请求地址。
//
// 必须保证"签名的串"与"发出去的串"完全一致，否则服务端校验不过。
func signedURL(endpoint string, params [][2]string) string {
	parts := make([]string, 0, len(params))
	for _, kv := range params {
		parts = append(parts, url.QueryEscape(kv[0])+"="+url.QueryEscape(kv[1]))
	}
	query := strings.Join(parts, "&")
	sign := GenerateABogus(query, desktopUA)
	return endpoint + "?" + query + "&a_bogus=" + url.QueryEscape(sign)
}

// cookieString 返回 cookie jar 里该地址对应的 cookie 串。
//
// 抖音的弹幕 WS 需要把 cookie 显式放进握手头（WS 不走 HTTP jar），
// 因此这里把页面请求时收下的 ttwid 等取出来。
func (c *Client) cookieString(rawURL string) string {
	return c.http.Cookies(rawURL)
}

// getJSON 抖音专用请求头的 GET。
//
// 注意这里**不再**同步等首页预热：预热只是"顺手拿 ttwid + 暖连接"，
// 同步等它会把首屏拖到 3s 以上。jar 会在第一次响应里自动收下 ttwid。
func (c *Client) getJSON(target string, out any) error {
	headers := map[string]string{
		"User-Agent":      desktopUA,
		"Referer":         referer,
		"Accept":          "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9",
		// 抖音对 br/gzip 都支持，但显式要求 identity 能少一层解压问题
		"Accept-Encoding": "identity",
	}
	return c.http.GetJSON(target, headers, out)
}

// sortedPairs 把 map 转成按 key 排序的键值对（用于需要固定顺序的场景）。
func sortedPairs(params map[string]string) [][2]string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([][2]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, [2]string{k, params[k]})
	}
	return out
}
