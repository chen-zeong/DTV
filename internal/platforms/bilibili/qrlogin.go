package bilibili

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"dtv/internal/platforms/common"
)

// B 站扫码登录（Web 端扫码协议）。
//
// 为什么不用"打开登录页 webview 再读 Cookie"的老办法：
//   - Wails v3 没有对外暴露 WebView2 / WKWebView 的 Cookie 接口
//   - SESSDATA 是 HttpOnly，页面 JS 也读不到
//
// 扫码协议本身就是给第三方用的公开接口，两步：
//  1. GET /x/passport-login/web/qrcode/generate 拿二维码内容 + qrcode_key
//  2. GET /x/passport-login/web/qrcode/poll 轮询扫码状态；
//     成功时响应头 Set-Cookie 与 data.url 的 query 里都带着
//     SESSDATA / bili_jct / DedeUserID，直接拼成 Cookie 串即可。
//
// 状态码（data.code）：
//
//	0     登录成功
//	86101 未扫码
//	86090 已扫码，未确认
//	86038 二维码失效
const (
	urlQRGenerate = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
	urlQRPoll     = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll"
	// urlLoginNav 用来在登录成功后取账号昵称/头像，顺便验证 Cookie 是否真的有效。
	urlLoginNav = "https://api.bilibili.com/x/web-interface/nav"

	// qrPollSource 与网页端保持一致，避免被风控识别成异常来源。
	qrPollSource = "main-fe-header"
)

// 拼 Cookie 时的字段顺序：SESSDATA / bili_jct 在前，便于排查。
var cookieKeyOrder = []string{
	"SESSDATA",
	"bili_jct",
	"DedeUserID",
	"DedeUserID__ckMd5",
	"sid",
	"buvid3",
	"buvid4",
}

// qrLoginHeaders 是扫码相关接口的请求头。
func qrLoginHeaders() map[string]string {
	return map[string]string{
		"User-Agent": desktopUA,
		"Referer":    "https://www.bilibili.com/",
		"Origin":     "https://www.bilibili.com",
	}
}

// QRLoginGenerate 申请一个登录二维码。
func (c *Client) QRLoginGenerate() (*common.QRLoginCode, error) {
	resp, err := c.http.Get(urlQRGenerate, qrLoginHeaders())
	if err != nil {
		return nil, describe("申请登录二维码失败", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取二维码响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("申请登录二维码失败: HTTP %d", resp.StatusCode)
	}

	var payload struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			URL       string `json:"url"`
			QRCodeKey string `json:"qrcode_key"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析二维码响应失败: %w", err)
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("申请登录二维码失败: code=%d (%s)", payload.Code, payload.Message)
	}
	if payload.Data.URL == "" || payload.Data.QRCodeKey == "" {
		return nil, fmt.Errorf("申请登录二维码失败: 上游未返回二维码内容")
	}

	return &common.QRLoginCode{
		URL: payload.Data.URL,
		Key: payload.Data.QRCodeKey,
		// B 站二维码 180 秒失效，这里按官方值返回，前端据此提示"已过期"。
		ExpiresIn: 180,
	}, nil
}

// QRLoginPoll 查询一次扫码状态；登录成功时把 Cookie 应用到 Client 并返回。
func (c *Client) QRLoginPoll(key string) (*common.QRLoginResult, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, fmt.Errorf("缺少 qrcode_key")
	}

	target := fmt.Sprintf("%s?qrcode_key=%s&source=%s", urlQRPoll, url.QueryEscape(key), qrPollSource)
	resp, err := c.http.Get(target, qrLoginHeaders())
	if err != nil {
		return nil, describe("查询扫码状态失败", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取扫码状态失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("查询扫码状态失败: HTTP %d", resp.StatusCode)
	}

	var payload struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析扫码状态失败: %w", err)
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("查询扫码状态失败: code=%d (%s)", payload.Code, payload.Message)
	}

	switch payload.Data.Code {
	case 0:
		// 登录成功：Cookie 在两处都有，合并成一个串
		collected := map[string]string{}
		mergeCookieJar(collected, c.http.Cookies("https://www.bilibili.com/"))
		mergeSetCookies(collected, resp.Cookies())
		mergeCookieQuery(collected, payload.Data.URL)

		cookie := buildCookieString(collected)
		if cookie == "" {
			return &common.QRLoginResult{
				Status:  common.QRStatusError,
				Message: "登录成功但没拿到 Cookie，请重试",
			}, nil
		}
		c.SetCookie(cookie)

		result := &common.QRLoginResult{
			Status:  common.QRStatusSuccess,
			Cookie:  cookie,
			Message: "登录成功",
		}
		// 顺带取昵称/头像（失败不影响登录结果）
		if profile, err := c.LoginProfile(); err == nil && profile.LoggedIn {
			result.UserName = profile.UserName
			result.Avatar = profile.Avatar
		}
		return result, nil
	case 86101:
		return &common.QRLoginResult{Status: common.QRStatusPending, Message: "等待手机扫码"}, nil
	case 86090:
		return &common.QRLoginResult{Status: common.QRStatusScanned, Message: "已扫码，请在手机上确认登录"}, nil
	case 86038:
		return &common.QRLoginResult{Status: common.QRStatusExpired, Message: "二维码已失效，请刷新"}, nil
	default:
		return &common.QRLoginResult{
			Status:  common.QRStatusError,
			Message: fmt.Sprintf("未知的扫码状态：%d %s", payload.Data.Code, payload.Data.Message),
		}, nil
	}
}

// Logout 退出登录：先让 B 站服务端使当前 SESSDATA 失效，再清空本地 Cookie。
//
// 只清本地 Cookie 时，同一会话在网页端/其它设备上仍然有效；调用
// passport 的 exit/v2（需要 bili_jct 作为 CSRF token）才是真正的"退出登录"。
// 即使服务端调用失败，本地也会回到未登录态（同时清 cookie jar）。
func (c *Client) Logout() error {
	cookie := c.Cookie()
	csrf := cookieValue(cookie, "bili_jct")

	var logoutErr error
	if cookie != "" && csrf != "" {
		form := url.Values{}
		form.Set("biliCSRF", csrf)

		// passport 的退出接口按网页端来源校验，这里用 www 而不是直播页。
		headers := c.headers()
		headers["Referer"] = "https://www.bilibili.com/"
		headers["Origin"] = "https://www.bilibili.com"

		resp, err := c.http.PostForm(urlLogout, form.Encode(), headers)
		if err != nil {
			logoutErr = describe("退出登录失败", err)
		} else {
			body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			_ = resp.Body.Close()
			switch {
			case readErr != nil:
				logoutErr = fmt.Errorf("读取退出登录响应失败: %w", readErr)
			default:
				var payload struct {
					Code    int    `json:"code"`
					Message string `json:"message"`
				}
				if err := json.Unmarshal(body, &payload); err != nil {
					logoutErr = fmt.Errorf("解析退出登录响应失败: %w", err)
				} else if payload.Code != 0 && payload.Code != -101 {
					logoutErr = fmt.Errorf("退出登录失败: code=%d (%s)", payload.Code, payload.Message)
				}
			}
		}
	}

	c.SetCookie("")
	c.http.ClearCookies()
	return logoutErr
}

// LoginProfile 用当前 Cookie 查一次 nav，拿到昵称与头像。
//
// 未登录 / Cookie 失效时返回 LoggedIn=false（不视为错误，前端据此提示重新登录）。
func (c *Client) LoginProfile() (*common.BilibiliProfile, error) {
	resp, err := c.http.Get(urlLoginNav, c.headers())
	if err != nil {
		return nil, describe("查询账号信息失败", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取账号信息失败: %w", err)
	}
	var payload struct {
		Code int `json:"code"`
		Data struct {
			IsLogin bool   `json:"isLogin"`
			Uname   string `json:"uname"`
			Face    string `json:"face"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析账号信息失败: %w", err)
	}
	// -101 未登录是正常情况，不当错误
	if payload.Code != 0 || !payload.Data.IsLogin {
		return &common.BilibiliProfile{LoggedIn: false}, nil
	}
	return &common.BilibiliProfile{
		LoggedIn: true,
		UserName: payload.Data.Uname,
		Avatar:   enforceHTTPS(payload.Data.Face),
	}, nil
}

// mergeCookieJar 把 jar 里的 Cookie 串（"k=v; k2=v2"）并入表。
func mergeCookieJar(dst map[string]string, raw string) {
	if raw == "" {
		return
	}
	for _, part := range strings.Split(raw, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || name == "" {
			continue
		}
		if _, exists := dst[name]; !exists {
			dst[name] = value
		}
	}
}

// mergeSetCookies 合并响应头 Set-Cookie 里的 Cookie。
func mergeSetCookies(dst map[string]string, cookies []*http.Cookie) {
	for _, ck := range cookies {
		if ck.Name == "" {
			continue
		}
		// 只收 B 站主域的 Cookie（passport 也会下发它自己的域）
		if ck.Domain != "" && !strings.Contains(ck.Domain, "bilibili.com") {
			continue
		}
		if _, exists := dst[ck.Name]; !exists {
			dst[ck.Name] = ck.Value
		}
	}
}

// mergeCookieQuery 从登录成功回调 URL 的 query 里提取 Cookie。
//
// 例：https://passport.biligame.com/...?SESSDATA=xxx&bili_jct=yyy&DedeUserID=123&...
func mergeCookieQuery(dst map[string]string, rawURL string) {
	if rawURL == "" {
		return
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return
	}
	for name, values := range u.Query() {
		if len(values) == 0 || values[0] == "" {
			continue
		}
		if _, exists := dst[name]; !exists {
			dst[name] = values[0]
		}
	}
}

// buildCookieString 按固定顺序拼 Cookie 头，未列出的字段排在最后。
func buildCookieString(cookies map[string]string) string {
	if len(cookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cookies))
	seen := make(map[string]bool, len(cookies))
	for _, name := range cookieKeyOrder {
		if v, ok := cookies[name]; ok && v != "" {
			parts = append(parts, name+"="+v)
			seen[name] = true
		}
	}
	// 剩余字段保持稳定顺序（map 遍历随机，排序后再拼）
	rest := make([]string, 0, len(cookies))
	for name, v := range cookies {
		if seen[name] || v == "" {
			continue
		}
		rest = append(rest, name+"="+v)
	}
	sort.Strings(rest)
	parts = append(parts, rest...)
	return strings.Join(parts, "; ")
}

// cookieValue 从 Cookie 串（"k=v; k2=v2"）里取单个字段的值。
func cookieValue(raw, name string) string {
	for _, part := range strings.Split(raw, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && strings.TrimSpace(key) == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// CookieHasLogin 判断 Cookie 串里是否含登录态必需字段（SESSDATA + bili_jct）。
func CookieHasLogin(raw string) bool {
	var hasSess, hasJct bool
	for _, part := range strings.Split(raw, ";") {
		name, _, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch name {
		case "SESSDATA":
			hasSess = true
		case "bili_jct":
			hasJct = true
		}
	}
	return hasSess && hasJct
}
