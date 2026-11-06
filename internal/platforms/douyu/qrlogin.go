package douyu

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"dtv/internal/platforms/common"
)

// 斗鱼扫码登录。
//
// 协议（以斗鱼 passport 现行 app-login-all.js 为准，与
// yijianguanzhu/douyu-qrcode-login 的旧实现一致）：
//  1. POST passport.douyu.com/scan/generateCode 拿 scan_code 与二维码内容；
//  2. 轮询 passport.douyu.com/japi/scan/auth?time=&code=；
//     error=-2 未扫码，1 已扫码，0 已确认，-1 取消/过期；
//  3. 已确认时 data.url 是登录回调地址，用 JSONP（callback=appClient_json_callback）
//     请求它拿最终 Set-Cookie；
//  4. 登录 Cookie 里的 dy_did 必须同时用于签名和请求头，否则斗鱼按游客处理；
//     因此二维码请求也要先带上本进程的 dy_did；
//  5. 用 passport.douyu.com/lapi/passport/iframe/safeAuth 续期。
const (
	urlQRGenerate = "https://passport.douyu.com/scan/generateCode"
	urlQRCheck    = "https://passport.douyu.com/japi/scan/auth"
	urlSafeAuth   = "https://passport.douyu.com/lapi/passport/iframe/safeAuth?client_id=1"

	qrLoginReferer = "https://passport.douyu.com/index/login?type=login&client_id=1"
)

func (c *Client) qrHeaders() map[string]string {
	// 必须带上 dy_did：斗鱼网页端在打开登录页前已经由 douyu-did.js 写好
	// dy_did，登录回调会把 dy_auth 绑定到这个设备号上。不带 did 时服务端
	// 也会签发 Cookie，但后续取流用的 did 与登录态对不上，会被按游客降档。
	did := c.authDID()
	return map[string]string{
		"accept":          "application/json, text/plain, */*",
		"accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
		"origin":          "https://passport.douyu.com",
		"referer":         qrLoginReferer,
		"user-agent":      desktopUA,
		"cookie":          "dy_did=" + did + "; acf_did=" + did,
	}
}

type qrGenerateResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  *struct {
		Code   string `json:"code"`
		Expire int    `json:"expire"`
		URL    string `json:"url"`
	} `json:"data"`
}

type qrCheckResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  any    `json:"data"`
}

// QRLoginGenerate 申请斗鱼登录二维码。
//
// 与 B 站不同，斗鱼直接把二维码要编码的 URL 放在 data.url（m.douyu.com 的
// 扫码中转页），前端用 uqr 渲染即可。
func (c *Client) QRLoginGenerate() (*common.QRLoginCode, error) {
	form := url.Values{}
	form.Set("client_id", "1")
	// 与网页端 passport 的请求体一致；缺省不影响扫码，但带上更贴近真实客户端。
	form.Set("isMultiAccount", "0")

	resp, err := c.http.PostForm(urlQRGenerate, form.Encode(), c.qrHeaders())
	if err != nil {
		return nil, fmt.Errorf("申请斗鱼登录二维码失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("申请斗鱼登录二维码失败：HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取斗鱼二维码响应失败：%w", err)
	}
	var payload qrGenerateResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析斗鱼二维码响应失败：%w", err)
	}
	if payload.Error != 0 {
		return nil, fmt.Errorf("申请斗鱼登录二维码失败：error=%d (%s)", payload.Error, payload.Msg)
	}
	if payload.Data == nil || payload.Data.Code == "" || payload.Data.URL == "" {
		return nil, fmt.Errorf("斗鱼未返回有效的二维码内容")
	}
	expire := payload.Data.Expire
	if expire <= 0 {
		expire = 300
	}
	return &common.QRLoginCode{
		URL:       payload.Data.URL,
		Key:       payload.Data.Code,
		ExpiresIn: expire,
	}, nil
}

// QRLoginPoll 查询一次扫码状态；确认后立即走登录回调拿 Cookie。
func (c *Client) QRLoginPoll(key string) (*common.QRLoginResult, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, fmt.Errorf("缺少扫码 code")
	}

	target := fmt.Sprintf("%s?time=%d&code=%s", urlQRCheck, time.Now().UnixMilli(), url.QueryEscape(key))
	resp, err := c.http.Get(target, c.qrHeaders())
	if err != nil {
		return nil, fmt.Errorf("查询斗鱼扫码状态失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("查询斗鱼扫码状态失败：HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取斗鱼扫码状态失败：%w", err)
	}
	var payload qrCheckResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("解析斗鱼扫码状态失败：%w", err)
	}

	message := stringFromQRData(payload.Data)
	switch payload.Error {
	case 0:
		data, ok := payload.Data.(map[string]any)
		if !ok {
			return &common.QRLoginResult{Status: common.QRStatusError, Message: "斗鱼登录返回了无法识别的数据"}, nil
		}
		loginPath, _ := data["url"].(string)
		if strings.TrimSpace(loginPath) == "" {
			return &common.QRLoginResult{Status: common.QRStatusError, Message: "斗鱼登录未返回回调地址"}, nil
		}
		return c.finishLogin(loginPath, resp.Cookies())
	case 1:
		return &common.QRLoginResult{Status: common.QRStatusScanned, Message: firstNonEmpty(message, payload.Msg, "已扫码，请在手机上确认登录")}, nil
	case -2:
		return &common.QRLoginResult{Status: common.QRStatusPending, Message: firstNonEmpty(message, payload.Msg, "等待手机扫码")}, nil
	case -1:
		return &common.QRLoginResult{Status: common.QRStatusExpired, Message: firstNonEmpty(message, payload.Msg, "二维码已失效，请刷新")}, nil
	case 9993, 9995, 9997, 9999:
		return &common.QRLoginResult{Status: common.QRStatusError, Message: firstNonEmpty(message, "斗鱼扫码登录失败")}, nil
	default:
		return &common.QRLoginResult{Status: common.QRStatusPending, Message: firstNonEmpty(message, payload.Msg, "等待手机扫码")}, nil
	}
}

// finishLogin 用 qrcode/check 返回的 url 走一次登录回调，收集 Set-Cookie。
func (c *Client) finishLogin(rawURL string, pollCookies []*http.Cookie) (*common.QRLoginResult, error) {
	loginURL := buildLoginCallbackURL(rawURL, time.Now().UnixMilli())
	resp, err := c.http.Get(loginURL, c.qrHeaders())
	if err != nil {
		return nil, fmt.Errorf("斗鱼登录回调失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("斗鱼登录回调失败：HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取斗鱼登录回调失败：%w", err)
	}
	payload, err := parseJSONPObject(body)
	if err != nil {
		return nil, fmt.Errorf("解析斗鱼登录回调失败：%w", err)
	}
	if code, _ := integerFromAny(payload["error"]); code != 0 {
		return &common.QRLoginResult{
			Status:  common.QRStatusError,
			Message: firstNonEmpty(stringFromQRData(payload["msg"]), "斗鱼登录失败"),
		}, nil
	}

	fields := map[string]string{}
	mergeCookieList(fields, pollCookies, false)
	mergeCookieList(fields, resp.Cookies(), true)
	// 浏览器 jar 里可能还有 passport 域下发的补充 Cookie。
	mergeCookieString(fields, c.http.Cookies("https://www.douyu.com/"), false)
	mergeCookieString(fields, c.http.Cookies("https://passport.douyu.com/"), false)

	if fields["dy_did"] == "" {
		fields["dy_did"] = c.authDID()
	}
	if fields["acf_did"] == "" {
		fields["acf_did"] = c.authDID()
	}
	cookie := buildCookieString(fields, []string{
		"dy_auth", "acf_auth", "acf_jwt_token", "dy_did", "acf_did",
		"LTP0", "acf_uid", "acf_stk", "acf_username",
	})
	if !cookieHasLogin(cookie) {
		return &common.QRLoginResult{
			Status:  common.QRStatusError,
			Message: "斗鱼登录成功但未拿到有效 Cookie，请重试",
		}, nil
	}

	c.SetCookie(cookie)
	result := &common.QRLoginResult{
		Status:  common.QRStatusSuccess,
		Message: "登录成功",
		Cookie:  cookie,
	}
	if data, ok := payload["data"].(map[string]any); ok {
		result.UserName = firstNonEmpty(
			stringFromQRData(data["nickname"]),
			stringFromQRData(data["nickName"]),
			stringFromQRData(data["nick_name"]),
			stringFromQRData(data["username"]),
			stringFromQRData(data["userName"]),
		)
		result.Avatar = firstNonEmpty(
			stringFromQRData(data["avatar"]),
			stringFromQRData(data["avatar_url"]),
			stringFromQRData(data["avatarUrl"]),
		)
	}
	// 登录回调一般不带昵称，但 acf_username 会写进登录 Cookie。
	if result.UserName == "" {
		result.UserName = cookieUserName(cookie)
	}
	// 用 safeAuth 校验/续期一次：能成功说明登录态确实可用，顺带补全 LTP0。
	// 失败不影响本次登录结果（可能只是网络问题），只记录日志。
	if refreshed, err := c.RefreshCookie(); err != nil {
		log.Printf("[Douyu] 登录后校验失败（仍按成功处理）: %v", err)
	} else if refreshed != "" {
		result.Cookie = refreshed
	}
	return result, nil
}

// RefreshCookie 用 passport 的 safeAuth 续期登录 Cookie。
//
// 斗鱼 Web 登录态通常 7 天；启动/进入房间前续一次，避免播放中途失效。
// 续期失败返回原 Cookie（error），调用方可以忽略并按未登录降级。
func (c *Client) RefreshCookie() (string, error) {
	full := c.fullCookie()
	if !cookieHasLogin(full) {
		return "", fmt.Errorf("斗鱼未登录")
	}

	headers := map[string]string{
		"accept":           "application/json, text/plain, */*",
		"accept-language":  "zh-CN,zh;q=0.9,en;q=0.7",
		"referer":          "https://www.douyu.com/directory/myFollow",
		"user-agent":       desktopUA,
		"x-requested-with": "XMLHttpRequest",
		"cookie":           full,
	}
	resp, err := c.http.Get(urlSafeAuth, headers)
	if err != nil {
		return c.Cookie(), err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return c.Cookie(), err
	}
	var payload struct {
		Error int    `json:"error"`
		Msg   string `json:"msg"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return c.Cookie(), err
	}
	if payload.Error != 0 {
		return c.Cookie(), fmt.Errorf("斗鱼 Cookie 续期失败：error=%d (%s)", payload.Error, payload.Msg)
	}

	fields := parseCookieFields(c.Cookie())
	mergeCookieList(fields, resp.Cookies(), true)
	if fields["dy_did"] == "" {
		fields["dy_did"] = c.authDID()
	}
	if fields["acf_did"] == "" {
		fields["acf_did"] = c.authDID()
	}
	cookie := buildCookieString(fields, []string{
		"dy_auth", "acf_auth", "acf_jwt_token", "dy_did", "acf_did",
		"LTP0", "acf_uid", "acf_stk", "acf_username",
	})
	if cookieHasLogin(cookie) {
		c.SetCookie(cookie)
		return cookie, nil
	}
	return c.Cookie(), fmt.Errorf("斗鱼 Cookie 续期后登录字段丢失")
}

// CookieValid 判断当前 Cookie 是否包含登录态字段（不发网络请求）。
func (c *Client) CookieValid() *common.DouyuProfile {
	cookie := c.Cookie()
	if !cookieHasLogin(cookie) {
		return &common.DouyuProfile{LoggedIn: false}
	}
	return &common.DouyuProfile{
		LoggedIn: true,
		UserName: cookieUserName(cookie),
	}
}

// CookieHasLogin 判断任意 Cookie 串里是否含斗鱼登录字段。
func CookieHasLogin(raw string) bool {
	return cookieHasLogin(raw)
}

// ---------------------------------------------------------------- 工具

func buildLoginCallbackURL(raw string, nowMs int64) string {
	login := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(login, "//"):
		login = "https:" + login
	case strings.HasPrefix(login, "http://"), strings.HasPrefix(login, "https://"):
		// 已经是完整地址
	default:
		login = "https://passport.douyu.com/" + strings.TrimLeft(login, "/")
	}
	separator := "?"
	if strings.Contains(login, "?") {
		separator = "&"
	}
	return login + separator + "callback=appClient_json_callback&_=" + strconv.FormatInt(nowMs, 10)
}

func parseJSONPObject(body []byte) (map[string]any, error) {
	start := bytes.IndexByte(body, '{')
	end := bytes.LastIndexByte(body, '}')
	if start < 0 || end < start {
		return nil, fmt.Errorf("响应不是 JSON/JSONP 对象")
	}
	var payload map[string]any
	if err := json.Unmarshal(body[start:end+1], &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func mergeCookieList(dst map[string]string, cookies []*http.Cookie, override bool) {
	for _, ck := range cookies {
		if ck.Name == "" || ck.Value == "" {
			continue
		}
		if ck.Domain != "" && !strings.Contains(strings.ToLower(ck.Domain), "douyu.com") {
			continue
		}
		if !override {
			if _, exists := dst[ck.Name]; exists {
				continue
			}
		}
		dst[ck.Name] = ck.Value
	}
}

func mergeCookieString(dst map[string]string, raw string, override bool) {
	for name, value := range parseCookieFields(raw) {
		if value == "" {
			continue
		}
		if !override {
			if _, exists := dst[name]; exists {
				continue
			}
		}
		dst[name] = value
	}
}

func stringFromQRData(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
}
