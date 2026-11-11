package bilibili

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

// logf 统一走标准库 logger（弹幕与调试日志共用）。
func logf(format string, args ...any) {
	log.Printf(format, args...)
}

// 端点常量，集中放一处便于核对。
const (
	urlLiveHome = "https://live.bilibili.com/lol"
	urlAreaList = "https://api.live.bilibili.com/room/v1/Area/getList"
	urlLiveList = "https://api.live.bilibili.com/xlive/web-interface/v1/second/getList"
	// room_init 从 2026-11 起对匿名请求直接 412，改用仍然可用的 get_info。
	urlRoomGetInfo  = "https://api.live.bilibili.com/room/v1/Room/get_info"
	urlRoomInfo     = "https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom"
	urlRoomPlayInfo = "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
	urlDanmuInfo    = "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo"
	urlWbiNav       = "https://api.bilibili.com/x/web-interface/nav"
	urlFingerSPI    = "https://api.bilibili.com/x/frontend/finger/spi"
	urlSearchType   = "https://api.bilibili.com/x/web-interface/search/type"
	urlLogout       = "https://passport.bilibili.com/login/exit/v2"
)

const (
	// desktopUA 用桌面 Chrome；B 站对 UA 与平台参数的一致性比较敏感
	// （playinfo 传 platform=html5 时配桌面 UA 是旧实现验证过的组合）。
	desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
	referer   = "https://live.bilibili.com/"
	origin    = "https://live.bilibili.com"
)

// 缓存时长：w_webid 是 JWT（ttl 24h），WBI key 每天换一次，这里都取 30 分钟保守值。
const (
	wWebIDTTL = 30 * time.Minute
	wbiKeyTTL = 30 * time.Minute
)

// debugEnabled 由环境变量 DTV_DANMAKU_DEBUG 控制。
var debugEnabled = os.Getenv("DTV_DANMAKU_DEBUG") != ""

func debugLog(format string, args ...any) {
	if debugEnabled {
		logf("[Bilibili][debug] "+format, args...)
	}
}

// Client 是 B 站各接口的统一入口，内部缓存三类易过期凭证：
//   - w_webid（直播列表签名必需，来自页面里的 access_id）
//   - WBI img_key/sub_key（房间信息、弹幕服务器签名必需）
//   - buvid3（搜索接口的人机校验用，缺失时从 finger/spi 取）
type Client struct {
	http *common.HttpClient

	mu       sync.Mutex
	wWebID   string
	wWebIDAt time.Time

	wbiImg   string
	wbiSub   string
	wbiAt    time.Time
	wbiErr   error
	wbiFetch sync.Mutex

	buvid   string
	buvidAt time.Time
	buvidMu sync.Mutex

	// cookie 是扫码登录拿到的浏览器 Cookie（"SESSDATA=…; bili_jct=…; …"）。
	// 空字符串表示未登录，此时沿用旧实现的 buvid3 占位。
	cookie   string
	cookieMu sync.RWMutex
}

// NewClient 构造客户端。
func NewClient() *Client {
	return &Client{http: common.NewHttpClient()}
}

// SetCookie 设置登录 Cookie（传空字符串表示退出登录）。
//
// 同时清空 HTTP 客户端的 cookie jar：扫码成功时 B 站会在 Set-Cookie 里下发
// SESSDATA 等字段，http.Client 会把它们自动加回后续请求。只改这里的 cookie
// 字段而不清 jar，退出登录后请求仍然带着旧登录态（"假退出"）。
func (c *Client) SetCookie(raw string) {
	c.cookieMu.Lock()
	c.cookie = strings.TrimSpace(raw)
	c.cookieMu.Unlock()
	c.http.ClearCookies()
}

// Cookie 返回当前登录 Cookie（未登录为空）。
func (c *Client) Cookie() string {
	c.cookieMu.RLock()
	defer c.cookieMu.RUnlock()
	return c.cookie
}

// headers 返回 B 站接口通用请求头。
func (c *Client) headers() map[string]string {
	cookie := c.Cookie()
	if cookie == "" {
		cookie = "buvid3=i;"
	} else if !strings.Contains(cookie, "buvid3=") {
		// buvid3 是 B 站风控用的设备指纹，登录 Cookie 里通常也有；
		// 缺失时补一个占位值（旧实现的做法），否则部分接口直接 412。
		if !strings.HasSuffix(cookie, ";") {
			cookie += ";"
		}
		cookie += " buvid3=i;"
	}
	return map[string]string{
		"User-Agent": desktopUA,
		"Referer":    referer,
		"Origin":     origin,
		"Cookie":     cookie,
	}
}

// getRaw 发起 GET 并返回响应体。
func (c *Client) getRaw(target string) ([]byte, error) {
	resp, err := c.http.Get(target, c.headers())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 12<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return body, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return body, nil
}

// getJSON 发起 GET 并解析 JSON。
func (c *Client) getJSON(target string, out any) error {
	body, err := c.getRaw(target)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("解析 %s 失败: %w", target, err)
	}
	return nil
}

// wWebIDPages 是可能带 access_id 的入口页。
//
// 实测同一个页面有时返回完整 SSR、有时只返回一个空壳（无 access_id），
// 所以多试几个入口，并允许回退到上一次成功取到的值。
var wWebIDPages = []string{
	"https://live.bilibili.com/lol",
	"https://live.bilibili.com/",
	"https://live.bilibili.com/p/eden/area-tags",
}

// wWebIDValue 取 w_webid（直播列表签名必需）。
func (c *Client) wWebIDValue() (string, error) {
	c.mu.Lock()
	if c.wWebID != "" && time.Since(c.wWebIDAt) < wWebIDTTL {
		v := c.wWebID
		c.mu.Unlock()
		return v, nil
	}
	stale := c.wWebID
	c.mu.Unlock()

	var lastErr error
	for _, page := range wWebIDPages {
		body, err := c.getRaw(page)
		if err != nil {
			lastErr = err
			continue
		}
		if id := extractAccessID(string(body)); id != "" {
			c.mu.Lock()
			c.wWebID = id
			c.wWebIDAt = time.Now()
			c.mu.Unlock()
			debugLog("w_webid 长度=%d（来源 %s）", len(id), page)
			return id, nil
		}
		lastErr = fmt.Errorf("%s 页面里没有 access_id", page)
	}

	// 都失败时用上一次的值兜底（JWT ttl 24h，稍微过期也还能用一会儿）
	if stale != "" {
		debugLog("刷新 w_webid 失败，沿用旧值: %v", lastErr)
		return stale, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("页面里没找到 access_id（w_webid）")
	}
	return "", fmt.Errorf("获取 w_webid 失败: %w", lastErr)
}

// extractAccessID 从直播页 HTML 里取 access_id。
//
// 页面里它藏在 window._render_data_ / 内嵌 JSON 中，两种写法（带空格/不带空格）都要兼容。
func extractAccessID(html string) string {
	needles := []string{`"access_id":"`, `"access_id": "`}
	for _, needle := range needles {
		idx := strings.Index(html, needle)
		if idx < 0 {
			continue
		}
		rest := html[idx+len(needle):]
		if end := strings.IndexByte(rest, '"'); end > 0 {
			return rest[:end]
		}
	}
	return ""
}

// wbiKeys 返回缓存的 WBI img_key/sub_key。
func (c *Client) wbiKeys() (string, string, error) {
	c.mu.Lock()
	if c.wbiImg != "" && time.Since(c.wbiAt) < wbiKeyTTL {
		img, sub, err := c.wbiImg, c.wbiSub, c.wbiErr
		c.mu.Unlock()
		return img, sub, err
	}
	c.mu.Unlock()

	// 单飞，避免并发请求同时刷新
	c.wbiFetch.Lock()
	defer c.wbiFetch.Unlock()

	c.mu.Lock()
	if c.wbiImg != "" && time.Since(c.wbiAt) < wbiKeyTTL {
		img, sub, err := c.wbiImg, c.wbiSub, c.wbiErr
		c.mu.Unlock()
		return img, sub, err
	}
	c.mu.Unlock()

	var resp struct {
		Data struct {
			WbiImg struct {
				ImgURL string `json:"img_url"`
				SubURL string `json:"sub_url"`
			} `json:"wbi_img"`
		} `json:"data"`
	}
	if err := c.getJSON(urlWbiNav, &resp); err != nil {
		c.mu.Lock()
		c.wbiErr = err
		c.mu.Unlock()
		return "", "", err
	}

	img := fileKey(resp.Data.WbiImg.ImgURL)
	sub := fileKey(resp.Data.WbiImg.SubURL)
	if img == "" || sub == "" {
		err := fmt.Errorf("nav 未返回 wbi_img")
		c.mu.Lock()
		c.wbiErr = err
		c.mu.Unlock()
		return "", "", err
	}

	c.mu.Lock()
	c.wbiImg, c.wbiSub, c.wbiAt, c.wbiErr = img, sub, time.Now(), nil
	c.mu.Unlock()
	debugLog("WBI keys: img=%s sub=%s", img, sub)
	return img, sub, nil
}

// fileKey 从 ".../xxx.png" 里取 "xxx"。
func fileKey(rawURL string) string {
	slash := strings.LastIndex(rawURL, "/")
	if slash < 0 {
		return ""
	}
	name := rawURL[slash+1:]
	if dot := strings.IndexByte(name, '.'); dot > 0 {
		name = name[:dot]
	}
	if dot := strings.LastIndexByte(name, '.'); dot > 0 {
		name = name[:dot]
	}
	return name
}

// buvidValue 取 buvid3（搜索接口需要）。
//
// 老实现从 finger/spi 拿 buvid3/buvid4 来"补足"设备指纹；
// 这里同样做，但失败不致命（只是不做人机校验兜底）。
func (c *Client) buvidValue() string {
	c.buvidMu.Lock()
	if c.buvid != "" && time.Since(c.buvidAt) < wWebIDTTL {
		v := c.buvid
		c.buvidMu.Unlock()
		return v
	}
	c.buvidMu.Unlock()

	var resp struct {
		Data struct {
			B3 string `json:"b_3"`
			B4 string `json:"b_4"`
		} `json:"data"`
	}
	if err := c.getJSON(urlFingerSPI, &resp); err != nil || resp.Data.B3 == "" {
		return ""
	}

	c.buvidMu.Lock()
	c.buvid = resp.Data.B3
	c.buvidAt = time.Now()
	c.buvidMu.Unlock()
	return resp.Data.B3
}

// describe 把错误统一成中文前缀，便于前端展示。
func describe(prefix string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", prefix, err)
}

// enforceHTTPS 把 http:// 升级成 https://（前端 <video>/播放器在有 https 页面时会拦 http）。
func enforceHTTPS(raw string) string {
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}

// apiError 表示 B 站业务错误（HTTP 200 + code != 0）。
type apiError struct {
	Code     int64
	Message  string
	Endpoint string
}

func (e *apiError) Error() string {
	msg := e.Message
	if msg == "" {
		msg = "-"
	}
	return fmt.Sprintf("bilibili %s 返回 code=%d (%s)", e.Endpoint, e.Code, msg)
}
