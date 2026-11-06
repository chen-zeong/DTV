// Package common 存放各平台共享的基础设施：HTTP 客户端、归一化类型、弹幕事件。
package common

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"
)

// DefaultUA 是所有请求的兜底 UA（对齐旧项目 common/http_client.rs）。
const DefaultUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

// AcceptLanguage 与旧项目一致：国内站点会按语言返回不同内容。
const AcceptLanguage = "zh-CN,zh;q=0.9"

const (
	defaultTimeout        = 45 * time.Second
	defaultConnectTimeout = 15 * time.Second
	// retryDelay 是单次瞬时错误后的重试间隔（旧项目为 180ms）。
	retryDelay = 180 * time.Millisecond
)

// ErrUnreachable 表示网络层失败（连不上/超时），用于让上层给出友好提示。
var ErrUnreachable = errors.New("网络不可达")

// HttpClient 是各平台共用的 HTTP 客户端封装。
//
// 对照旧项目 platforms/common/http_client.rs 的 HttpClient：
//   - 关闭 HTTP/2、限制连接数、带 cookie jar、忽略系统代理
//   - GET 遇到瞬时错误（握手/连接重置）自动重试一次
type HttpClient struct {
	inner *http.Client
	jar   *cookieStore
}

// cookieStore 是带锁的 cookie jar。
//
// 标准库 http.Client 会在每个请求上自动带上 jar 里的 cookie，而退出登录时
// 必须能把它们一次性清掉（否则 UI 已经显示未登录，请求却仍带着 SESSDATA /
// dy_auth，等于没退）。标准库的 cookiejar 没有 Clear，这里用一层可替换的
// 包装实现「清空」，同时保证并发请求读 jar 时不会和替换发生数据竞争。
type cookieStore struct {
	mu  sync.RWMutex
	jar http.CookieJar
}

func newCookieStore() *cookieStore {
	jar, _ := cookiejar.New(nil)
	return &cookieStore{jar: jar}
}

func (s *cookieStore) SetCookies(u *url.URL, cookies []*http.Cookie) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jar != nil {
		s.jar.SetCookies(u, cookies)
	}
}

func (s *cookieStore) Cookies(u *url.URL) []*http.Cookie {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.jar == nil {
		return nil
	}
	return s.jar.Cookies(u)
}

// clear 丢弃全部已保存的 cookie。
func (s *cookieStore) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	jar, err := cookiejar.New(nil)
	if err != nil {
		s.jar = nil
		return
	}
	s.jar = jar
}

// NewHttpClient 创建直连（忽略系统代理）的客户端。
//
// 注意：Go 默认会读 HTTP_PROXY/HTTPS_PROXY 环境变量；旧项目三个阶段都显式
// 关闭了代理（no_proxy），这里通过 Proxy: nil 达到同样效果 —— 斗鱼/虎牙这类
// 接口经代理转发反而更容易被风控或返回 403。
func NewHttpClient() *HttpClient {
	jar := newCookieStore()

	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: defaultConnectTimeout, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &HttpClient{
		inner: &http.Client{
			Transport: transport,
			Timeout:   defaultTimeout,
			Jar:       jar,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return fmt.Errorf("stopped after 10 redirects")
				}
				return nil
			},
		},
		jar: jar,
	}
}

// NewLimitedHttpClient 创建连接池较小的客户端，用于关注列表刷新等低并发任务。
func NewLimitedHttpClient(maxIdlePerHost int) *HttpClient {
	c := NewHttpClient()
	transport := c.inner.Transport.(*http.Transport)
	transport.MaxIdleConnsPerHost = maxIdlePerHost
	transport.IdleConnTimeout = 15 * time.Second
	return c
}

// Request 发送一次带默认头的请求（不自动重试）。
func (c *HttpClient) Do(req *http.Request) (*http.Response, error) {
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", DefaultUA)
	}
	if req.Header.Get("Accept-Language") == "" {
		req.Header.Set("Accept-Language", AcceptLanguage)
	}
	return c.inner.Do(req)
}

// Cookies 返回当前 cookie jar 里该地址对应的 cookie 串（"k=v; k2=v2"）。
//
// 用途：某些接口（如抖音弹幕 WS、关注列表核对）需要把 cookie 显式放进
// 请求头或 WS 握手头，而 jar 只会自动作用于同域 HTTP 请求。
func (c *HttpClient) Cookies(rawURL string) string {
	if c.jar == nil {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	cookies := c.jar.Cookies(u)
	if len(cookies) == 0 {
		return ""
	}
	parts := make([]string, 0, len(cookies))
	for _, ck := range cookies {
		parts = append(parts, ck.Name+"="+ck.Value)
	}
	return strings.Join(parts, "; ")
}

// ClearCookies 清空 cookie jar。
//
// 退出登录时必须调用：http.Client 会自动把 jar 里的 cookie 加回请求头，
// 只把平台自己的 cookie 字段置空并不能阻止请求继续带着登录态。
func (c *HttpClient) ClearCookies() {
	if c.jar != nil {
		c.jar.clear()
	}
}

// IsTransient 判断是否值得重试。
func IsTransient(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.ErrClosedPipe) {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, s := range []string{"unexpected eof", "handshake", "connection reset", "connection closed", "broken pipe", "eof", "timeout"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// Get 发起 GET，并对瞬时错误重试一次。
func (c *HttpClient) Get(url string, headers map[string]string) (*http.Response, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			if v != "" {
				req.Header.Set(k, v)
			}
		}
		resp, err := c.Do(req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if attempt == 0 && IsTransient(err) {
			time.Sleep(retryDelay)
			continue
		}
		break
	}
	return nil, describe(err2net(lastErr))
}

// GetText 取文本，非 2xx 直接报错（错误信息带响应体，便于定位风控/参数问题）。
func (c *HttpClient) GetText(rawURL string, headers map[string]string) (string, error) {
	resp, err := c.Get(rawURL, headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败 (%s): %w", rawURL, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("GET %s 返回 HTTP %d: %s", rawURL, resp.StatusCode, truncate(string(body), 200))
	}
	return string(body), nil
}

// GetJSON 取 JSON 并解码到 out（必须是可解码的指针/结构体）。
func (c *HttpClient) GetJSON(rawURL string, headers map[string]string, out any) error {
	text, err := c.GetText(rawURL, headers)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(text), out); err != nil {
		return fmt.Errorf("解析 JSON 失败 (%s): %w, body=%s", rawURL, err, truncate(text, 200))
	}
	return nil
}

// PostForm 发 application/x-www-form-urlencoded 请求，返回响应体文本。
func (c *HttpClient) PostForm(rawURL, form string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, rawURL, strings.NewReader(form))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	return c.Do(req)
}

// PostFormJSON 发表单请求并解码 JSON 响应。
func (c *HttpClient) PostFormJSON(rawURL, form string, headers map[string]string, out any) error {
	resp, err := c.PostForm(rawURL, form, headers)
	if err != nil {
		return describe(err2net(err))
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败 (%s): %w", rawURL, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("POST %s 返回 HTTP %d: %s", rawURL, resp.StatusCode, truncate(string(body), 200))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("解析 JSON 失败 (%s): %w, body=%s", rawURL, err, truncate(string(body), 200))
	}
	return nil
}

// BuildQuery 拼接 query（值会做 URL 编码）。
func BuildQuery(rawURL string, params map[string]string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		// 解析失败时退回手工拼接，保证不会因为一个坏 URL 直接 panic
		q := url.Values{}
		for k, v := range params {
			q.Set(k, v)
		}
		if strings.Contains(rawURL, "?") {
			return rawURL + "&" + q.Encode()
		}
		return rawURL + "?" + q.Encode()
	}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// err2net 把 http.Client 的超时错误归一成 ErrUnreachable，便于上层统一判定。
func err2net(err error) error {
	if err == nil {
		return nil
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	return err
}

// describe 给错误加上统一前缀，避免各平台各写一套。
func describe(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrUnreachable) {
		return err
	}
	return fmt.Errorf("请求失败: %w", err)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
