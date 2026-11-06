package douyin

import (
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
}

// NewClient 创建抖音客户端。
//
// 首页 cookie 预热（换 ttwid）只放到后台跑：它是 1.5~2s 的一次性开销，
// 挡在列表请求前面会让"第一次进抖音分区"慢上三四秒（旧实现用硬编码
// cookie，所以从来没有这笔开销）。实测列表接口不带 cookie 也能正常返回，
// 预热只是为了拿到 ttwid 并顺手把 TLS 连接暖起来，绝不该阻塞首屏。
func NewClient() *Client {
	c := &Client{http: common.NewHttpClient()}
	go func() { _ = c.warmup() }()
	return c
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
