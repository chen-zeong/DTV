package douyu

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

// 本文件对齐 pure_live 的斗鱼取流实现：
//   - websec/getEncryption 拿加密描述符，缓存 5 分钟，失败强制刷新重试；
//   - MD5 链算 auth，POST getH5PlayV1，参数含 iar=0 / ver=Douyu_new；
//   - 每个进程随机 did，并在 Cookie 里同时发送 dy_did / acf_did；
//   - 解析 multirates 时保持平台顺序，rate 作为稳定 id，不做数值大小排序；
//   - 每个清晰度按 CDN 逐个解析，按服务端确认的实际 rate 分组，优先请求档位；
//   - 同组 URL 全部保留（多 CDN 失败切换），并把 expire=300&fcdn=ws 补成 expire=0。

// ---------------------------------------------------------------- 接口响应模型

type encryptionPayload struct {
	Key       string `json:"key"`
	RandStr   string `json:"rand_str"`
	EncTime   int    `json:"enc_time"`
	EncData   string `json:"enc_data"`
	IsSpecial int    `json:"is_special"`
	ExpireAt  int64  `json:"expire_at"`
}

type encryptionResponse struct {
	Error int                `json:"error"`
	Msg   string             `json:"msg"`
	Data  *encryptionPayload `json:"data"`
}

// encryptionData 是缓存的签名材料。
type encryptionData struct {
	did       string
	key       string
	randStr   string
	encTime   int
	encData   string
	isSpecial int
	expiryAt  int64
}

type playData struct {
	RoomID       any    `json:"room_id"`
	RtmpURL      string `json:"rtmp_url"`
	RtmpLive     string `json:"rtmp_live"`
	RtmpCDN      string `json:"rtmp_cdn"`
	FlvURL       any    `json:"flv_url"`
	Player1      any    `json:"player_1"`
	StreamURL    any    `json:"stream_url"`
	URL          any    `json:"url"`
	Rate         any    `json:"rate"`
	CdnsWithName []struct {
		Name string `json:"name"`
		CDN  string `json:"cdn"`
	} `json:"cdnsWithName"`
	Multirates []struct {
		Name    string `json:"name"`
		Rate    any    `json:"rate"`
		Bit     any    `json:"bit"`
		HighBit any    `json:"highBit"`
	} `json:"multirates"`
}

type playResponse struct {
	Error int       `json:"error"`
	Code  int       `json:"code"`
	Msg   string    `json:"msg"`
	Data  *playData `json:"data"`
}

// rateVariant 是一个清晰度档位（斗鱼叫 rate）。
type rateVariant struct {
	Name string
	Rate int
	Bit  int
}

// playURLResolution 是单个 CDN、单个档位的解析结果。
type playURLResolution struct {
	URLs        []string
	AppliedRate *int
	Unconfirmed bool
}

// ---------------------------------------------------------------- 请求头 / 签名

func (c *Client) requestHeaders(roomID string) map[string]string {
	return c.requestHeadersForDID(roomID, c.authDID())
}

func (c *Client) requestHeadersForDID(roomID, did string) map[string]string {
	referer := "https://www.douyu.com/"
	if roomID != "" {
		referer = refererFor(roomID)
	}

	return map[string]string{
		"accept":          "application/json, text/plain, */*",
		"accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
		"origin":          "https://www.douyu.com",
		"referer":         referer,
		"user-agent":      desktopUA,
		"cookie":          c.requestCookie(did),
	}
}

const (
	encryptionCacheMaxAge = 5 * time.Minute
	encryptionExpiryGuard = 30 * time.Second
)

// ensureEncryption 获取/复用加密描述符。
//
// 与 pure_live 一致：同一个 did、5 分钟内的描述符可复用；
// expire_at 距到期不足 30 秒、字段缺失或 enc_time 非法都会重新获取。
func (c *Client) ensureEncryption(force bool) (*encryptionData, error) {
	c.encMu.Lock()
	defer c.encMu.Unlock()

	did := c.authDID()
	now := time.Now()
	if !force && c.enc != nil && c.encDID == did &&
		now.Sub(c.encFetchedAt) < encryptionCacheMaxAge &&
		c.enc.expiryAt > now.Unix()+int64(encryptionExpiryGuard/time.Second) &&
		c.enc.encTime >= 1 && c.enc.encTime <= 16 &&
		c.enc.key != "" && c.enc.randStr != "" && c.enc.encData != "" {
		return c.enc, nil
	}

	resp, err := c.http.Get(fmt.Sprintf(urlGetEncryption, did), c.requestHeadersForDID("", did))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("斗鱼签名接口返回 HTTP %d", resp.StatusCode)
	}

	var payload encryptionResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("解析斗鱼签名接口失败：%w", err)
	}
	if payload.Error != 0 {
		return nil, fmt.Errorf("斗鱼签名接口返回 error=%d msg=%s", payload.Error, payload.Msg)
	}
	d := payload.Data
	if d == nil || d.Key == "" || d.RandStr == "" || d.EncData == "" {
		return nil, fmt.Errorf("斗鱼签名接口未返回有效参数")
	}
	if d.EncTime < 1 || d.EncTime > 16 {
		return nil, fmt.Errorf("斗鱼签名接口 enc_time 非法：%d", d.EncTime)
	}
	if d.ExpireAt <= now.Unix()+int64(encryptionExpiryGuard/time.Second) {
		return nil, fmt.Errorf("斗鱼签名描述符已过期")
	}

	c.enc = &encryptionData{
		did:       did,
		key:       d.Key,
		randStr:   d.RandStr,
		encTime:   d.EncTime,
		encData:   d.EncData,
		isSpecial: d.IsSpecial,
		expiryAt:  d.ExpireAt,
	}
	c.encFetchedAt = now
	c.encDID = did
	return c.enc, nil
}

// sign 生成 getH5PlayV1 的表单体。
//
// 参数顺序与 pure_live 的 Uri(queryParameters) 不完全一致（Go url.Values 会
// 按 key 排序），斗鱼只校验字段值；字段本身必须一致：
// enc_data / tt / did / auth / cdn / rate / hevc / fa / ive / ver / iar。
func (c *Client) sign(roomID string, rate int, cdn string, force bool) (string, string, error) {
	enc, err := c.ensureEncryption(force)
	if err != nil {
		return "", "", err
	}

	ts := time.Now().Unix()
	suffix := ""
	if enc.isSpecial != 1 {
		suffix = roomID + strconv.FormatInt(ts, 10)
	}
	secret := enc.randStr
	for i := 0; i < enc.encTime; i++ {
		secret = md5Hex(secret + enc.key)
	}

	form := url.Values{}
	form.Set("enc_data", enc.encData)
	form.Set("tt", strconv.FormatInt(ts, 10))
	form.Set("did", enc.did)
	form.Set("auth", md5Hex(secret+enc.key+suffix))
	form.Set("cdn", cdn)
	form.Set("rate", strconv.Itoa(rate))
	form.Set("hevc", "0")
	form.Set("fa", "0")
	form.Set("ive", "0")
	form.Set("ver", "Douyu_new")
	form.Set("iar", "0")
	return form.Encode(), enc.did, nil
}

func md5Hex(value string) string {
	sum := md5.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

// requestPlayData 发起一次 getH5PlayV1，失败时强制刷新签名描述符重试一次。
func (c *Client) requestPlayData(roomID string, rate int, cdn string) (*playResponse, error) {
	if strings.TrimSpace(roomID) == "" {
		return nil, fmt.Errorf("缺少房间号")
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		form, did, err := c.sign(roomID, rate, cdn, attempt > 0)
		if err != nil {
			lastErr = err
			continue
		}

		var payload playResponse
		if err := c.http.PostFormJSON(fmt.Sprintf(urlGetH5Play, roomID), form, c.requestHeadersForDID(roomID, did), &payload); err != nil {
			lastErr = err
			continue
		}
		code := payload.Error
		if code == 0 {
			code = payload.Code
		}
		if code != 0 {
			lastErr = fmt.Errorf("斗鱼取流接口返回 error=%d msg=%s（rate=%d cdn=%s）", code, payload.Msg, rate, cdn)
			continue
		}
		if payload.Data == nil {
			lastErr = fmt.Errorf("斗鱼取流接口未返回 data（rate=%d cdn=%s）", rate, cdn)
			continue
		}
		return &payload, nil
	}
	return nil, lastErr
}

// ---------------------------------------------------------------- 清晰度 / 线路

func (c *Client) playQualities(roomID string) ([]rateVariant, []common.LineOption, error) {
	payload, err := c.requestPlayData(roomID, -1, "")
	if err != nil {
		return nil, nil, err
	}
	return parsePlayQualities(payload.Data), parseCDNs(payload.Data), nil
}

// parsePlayQualities 保持斗鱼下发的 multirates 顺序，rate 作为稳定 id。
//
// 斗鱼的 rate 是“请求码”，不是码率，不能按数值大小排序；
// 例如原画常见为 0，蓝光4M 为 4，超清为 3，高清为 2。
func parsePlayQualities(data *playData) []rateVariant {
	rates := make([]rateVariant, 0, len(data.Multirates))
	seen := make(map[int]bool, len(data.Multirates))
	for _, item := range data.Multirates {
		rate, ok := integerFromAny(item.Rate)
		if !ok {
			continue
		}
		if seen[rate] {
			continue
		}
		seen[rate] = true
		rates = append(rates, rateVariant{
			Name: strings.TrimSpace(item.Name),
			Rate: rate,
			Bit:  int(jsonInt64(item.Bit)),
		})
	}
	if len(rates) == 0 {
		rate, ok := integerFromAny(data.Rate)
		if !ok {
			rate = -1
		}
		rates = append(rates, rateVariant{Name: "默认", Rate: rate})
	}
	return rates
}

// parseCDNs 按 pure_live 的规则整理线路：
//   - rtmp_cdn 若不在 cdnsWithName 里，插到最前面；
//   - scdn* 线路排到最后（其它线路保持平台顺序）；
//   - 没有线路时保留一个空 cdn（由服务端选默认线路）。
func parseCDNs(data *playData) []common.LineOption {
	result := make([]common.LineOption, 0, len(data.CdnsWithName)+1)
	seen := make(map[string]bool, len(data.CdnsWithName)+1)

	add := func(cdn, label string) {
		cdn = strings.TrimSpace(cdn)
		if cdn == "" || seen[cdn] {
			return
		}
		seen[cdn] = true
		label = strings.TrimSpace(label)
		if label == "" {
			label = cdn
		}
		result = append(result, common.LineOption{ID: cdn, Label: label})
	}

	for _, item := range data.CdnsWithName {
		add(item.CDN, item.Name)
	}
	current := strings.TrimSpace(data.RtmpCDN)
	if current != "" && !seen[current] {
		result = append([]common.LineOption{{ID: current, Label: current}}, result...)
	}
	if len(result) == 0 {
		result = append(result, common.LineOption{ID: "", Label: "默认"})
	}

	sort.SliceStable(result, func(i, j int) bool {
		iScdn := strings.HasPrefix(strings.ToLower(result[i].ID), "scdn")
		jScdn := strings.HasPrefix(strings.ToLower(result[j].ID), "scdn")
		return !iScdn && jScdn
	})
	return result
}

// orderCDNsForLine 把用户选中的线路移到最前，其余保持平台顺序。
// 只用于生成 URL 列表的顺序；info.Lines 仍保持平台顺序。
func orderCDNsForLine(cdns []common.LineOption, line string) []common.LineOption {
	wanted := strings.ToLower(strings.TrimSpace(line))
	if wanted == "" {
		return cdns
	}
	index := -1
	for i, item := range cdns {
		if strings.ToLower(item.ID) == wanted || strings.ToLower(item.Label) == wanted {
			index = i
			break
		}
	}
	if index <= 0 {
		return cdns
	}
	ordered := make([]common.LineOption, 0, len(cdns))
	ordered = append(ordered, cdns[index])
	ordered = append(ordered, cdns[:index]...)
	ordered = append(ordered, cdns[index+1:]...)
	return ordered
}

// selectCDN 选线路：优先用请求的那条，否则用第一条。
func selectCDN(requested string, lines []common.LineOption) string {
	trimmed := strings.ToLower(strings.TrimSpace(requested))
	if trimmed != "" {
		for _, line := range lines {
			if strings.ToLower(line.ID) == trimmed {
				return line.ID
			}
			if strings.ToLower(line.Label) == trimmed {
				return line.ID
			}
		}
	}
	if len(lines) > 0 {
		return lines[0].ID
	}
	if trimmed != "" {
		return trimmed
	}
	return defaultCDN
}

// ---------------------------------------------------------------- URL 解析

func parsePlayURL(data *playData) (string, error) {
	live := strings.TrimSpace(html.UnescapeString(data.RtmpLive))
	if isPlayableURL(live) {
		return live, nil
	}

	for _, base := range []string{
		strings.TrimSpace(html.UnescapeString(data.RtmpURL)),
		strings.TrimSpace(html.UnescapeString(jsonString(data.FlvURL))),
	} {
		if base == "" || live == "" {
			continue
		}
		combined := strings.TrimRight(base, "/") + "/" + strings.TrimLeft(live, "/")
		if isPlayableURL(combined) {
			return combined, nil
		}
	}

	for _, candidate := range []string{
		jsonString(data.Player1),
		jsonString(data.StreamURL),
		jsonString(data.URL),
	} {
		value := strings.TrimSpace(html.UnescapeString(candidate))
		if isPlayableURL(value) {
			return value, nil
		}
	}

	flvURL := strings.TrimSpace(html.UnescapeString(jsonString(data.FlvURL)))
	if isDirectMediaURL(flvURL) {
		return flvURL, nil
	}
	return "", fmt.Errorf("斗鱼取流响应里没有可播放地址")
}

func isPlayableURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return false
	}
	switch parsed.Scheme {
	case "http", "https", "rtmp":
		return true
	default:
		return false
	}
}

func isDirectMediaURL(value string) bool {
	if !isPlayableURL(value) {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	path := strings.ToLower(parsed.Path)
	return strings.HasSuffix(path, ".flv") || strings.HasSuffix(path, ".m3u8") || strings.HasSuffix(path, ".mp4")
}

// applyExpirePatch 与 pure_live 相同的续期补丁：
// 海外/部分匿名会话拿到的 ws CDN 直链只有 300 秒，附加 expire=0 让 CDN
// 按默认时长签发，避免播放 5 分钟后断流。
func applyExpirePatch(rawURL string) string {
	if strings.Contains(rawURL, "expire=300") && strings.Contains(rawURL, "fcdn=ws") {
		return rawURL + "&expire=0"
	}
	return rawURL
}

func integerFromAny(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		if math.Trunc(v) == v {
			return int(v), true
		}
		return 0, false
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return int(n), true
		}
		return 0, false
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return 0, false
		}
		if n, err := strconv.Atoi(text); err == nil {
			return n, true
		}
		if f, err := strconv.ParseFloat(text, 64); err == nil && math.Trunc(f) == f {
			return int(f), true
		}
	}
	return 0, false
}

// resolvePlayURL 请求单个 CDN 的单个档位，并返回服务端确认的实际 rate。
func (c *Client) resolvePlayURL(roomID string, rate int, cdn string) (playURLResolution, error) {
	payload, err := c.requestPlayData(roomID, rate, cdn)
	if err != nil {
		return playURLResolution{}, err
	}
	playURL, err := parsePlayURL(payload.Data)
	if err != nil {
		return playURLResolution{}, err
	}
	playURL = applyExpirePatch(playURL)

	res := playURLResolution{URLs: []string{playURL}}
	if applied, ok := integerFromAny(payload.Data.Rate); ok && applied >= 0 {
		res.AppliedRate = &applied
	} else {
		res.Unconfirmed = true
	}
	return res, nil
}

// resolveQualityURLs 按 pure_live 的规则解析一个清晰度：
// 逐个 CDN 请求，按“服务端确认的实际 rate”分组；优先请求档位，
// 否则选第一个有确认的档位组；全部未确认时用未知组并标记 unconfirmed。
func (c *Client) resolveQualityURLs(roomID string, requested rateVariant, cdns []common.LineOption) ([]string, *int, bool, error) {
	type group struct {
		rate  int
		known bool
		urls  []string
	}
	groups := make([]group, 0, len(cdns))
	index := make(map[int]int, len(cdns))
	var lastErr error

	for _, cdn := range cdns {
		resolution, err := c.resolvePlayURL(roomID, requested.Rate, cdn.ID)
		if err != nil {
			lastErr = err
			continue
		}

		key := -1
		known := false
		if resolution.AppliedRate != nil && *resolution.AppliedRate >= 0 {
			key = *resolution.AppliedRate
			known = true
		}
		idx, ok := index[key]
		if !ok {
			idx = len(groups)
			index[key] = idx
			groups = append(groups, group{rate: key})
		}
		if known {
			groups[idx].known = true
			groups[idx].rate = key
		}
		for _, item := range resolution.URLs {
			if !containsString(groups[idx].urls, item) {
				groups[idx].urls = append(groups[idx].urls, item)
			}
		}
	}

	if len(groups) == 0 {
		if lastErr != nil {
			return nil, nil, true, lastErr
		}
		return nil, nil, true, fmt.Errorf("斗鱼没有返回可用的直播流")
	}

	if requested.Rate >= 0 {
		if idx, ok := index[requested.Rate]; ok {
			rate := groups[idx].rate
			return groups[idx].urls, &rate, false, nil
		}
	}
	for _, item := range groups {
		if item.known {
			rate := item.rate
			return item.urls, &rate, false, nil
		}
	}
	return groups[0].urls, nil, true, nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- 对外接口

// StreamInfo 是播放页的主入口：一次拿到房间信息 + 所有清晰度 + 所有线路。
//
// 清晰度保持斗鱼 multirates 顺序；每个清晰度会把所有 CDN 都解析一遍，
// 返回同一“确认档位”的多个 URL（URLs），URL 取其中第一条。
// 这样既保留平台原始档位名，也避免把不同实际档位的 URL 混在一个选项里。
func (c *Client) StreamInfo(roomID, line string) (*common.StreamInfo, error) {
	detail, err := c.FetchRoomDetail(roomID)
	if err != nil {
		return nil, err
	}

	info := &common.StreamInfo{
		RoomID:   detail.RealRoomID,
		Platform: string(common.PlatformDouyu),
		Title:    detail.Title,
		Nickname: detail.Nickname,
		Avatar:   detail.Avatar,
		IsLive:   detail.IsLive,
		Variants: []common.StreamVariant{},
		Lines:    []common.LineOption{},
	}
	if !detail.IsLive {
		return info, nil
	}

	rates, cdns, err := c.playQualities(detail.RealRoomID)
	if err != nil {
		return nil, err
	}
	info.Lines = cdns
	resolveCDNs := orderCDNsForLine(cdns, line)

	type qualityResult struct {
		variant common.StreamVariant
		err     error
	}
	results := make([]qualityResult, len(rates))

	var wg sync.WaitGroup
	for i, rate := range rates {
		wg.Add(1)
		go func(idx int, requested rateVariant) {
			defer wg.Done()
			urls, applied, unconfirmed, err := c.resolveQualityURLs(detail.RealRoomID, requested, resolveCDNs)
			if err != nil {
				results[idx] = qualityResult{err: err}
				return
			}
			if len(urls) == 0 {
				results[idx] = qualityResult{err: fmt.Errorf("清晰度 %s 没有可用地址", rateLabel(requested))}
				return
			}
			results[idx] = qualityResult{variant: common.StreamVariant{
				ID:          strconv.Itoa(requested.Rate),
				Label:       rateLabel(requested),
				URL:         urls[0],
				Format:      "flv",
				URLs:        urls,
				AppliedRate: applied,
				Unconfirmed: unconfirmed,
			}}
		}(i, rate)
	}
	wg.Wait()

	var firstErr error
	for _, result := range results {
		if result.err != nil {
			if firstErr == nil {
				firstErr = result.err
			}
			continue
		}
		info.Variants = append(info.Variants, result.variant)
	}
	if len(info.Variants) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("房间 %s 没有可用的直播流", detail.RealRoomID)
	}
	return info, nil
}

// rateLabel 保持斗鱼下发的档位名；没有名字时用“默认”。
func rateLabel(rate rateVariant) string {
	name := strings.TrimSpace(rate.Name)
	if name == "" || strings.EqualFold(name, "default") {
		return "默认"
	}
	return name
}

// resolveRate 按前端传来的 quality 找到对应 rate。
// 支持 rate 数字（"0"/"4"）、旧存储值（source/high/standard）以及中文档位名。
func resolveRate(quality string, rates []rateVariant) (rateVariant, bool) {
	if len(rates) == 0 {
		return rateVariant{}, false
	}

	trimmed := strings.TrimSpace(quality)
	lower := strings.ToLower(trimmed)

	if n, err := strconv.Atoi(trimmed); err == nil {
		for _, r := range rates {
			if r.Rate == n {
				return r, true
			}
		}
	}
	// 兼容上一版持久化的 "rate-4" / "rate-8"。
	if strings.HasPrefix(lower, "rate-") {
		if n, err := strconv.Atoi(strings.TrimPrefix(lower, "rate-")); err == nil {
			for _, r := range rates {
				if r.Rate == n {
					return r, true
				}
			}
		}
	}
	if lower == "high" {
		return highestBitExcludingZero(rates), true
	}
	if lower == "standard" {
		return lowestBitExcludingZero(rates), true
	}
	if strings.Contains(trimmed, "原画") || lower == "origin" || lower == "source" {
		for _, r := range rates {
			if r.Rate == 0 {
				return r, true
			}
		}
		for _, r := range rates {
			if strings.Contains(r.Name, "原画") {
				return r, true
			}
		}
		return rates[0], true
	}
	if strings.Contains(trimmed, "高") {
		for _, keyword := range []string{"高清", "超清"} {
			for _, r := range rates {
				if strings.Contains(r.Name, keyword) {
					return r, true
				}
			}
		}
		return highestBitExcludingZero(rates), true
	}
	if strings.Contains(trimmed, "标") {
		for _, keyword := range []string{"标清", "流畅", "普清"} {
			for _, r := range rates {
				if strings.Contains(r.Name, keyword) {
					return r, true
				}
			}
		}
		return lowestBitExcludingZero(rates), true
	}
	for _, r := range rates {
		if strings.Contains(r.Name, trimmed) {
			return r, true
		}
	}
	return rateVariant{}, false
}

func highestBitExcludingZero(rates []rateVariant) rateVariant {
	var best rateVariant
	found := false
	for _, r := range rates {
		if r.Rate == 0 {
			continue
		}
		if !found || r.Bit > best.Bit {
			best, found = r, true
		}
	}
	if found {
		return best
	}
	return rates[0]
}

func lowestBitExcludingZero(rates []rateVariant) rateVariant {
	var best rateVariant
	found := false
	for _, r := range rates {
		if r.Rate == 0 {
			continue
		}
		if !found || r.Bit < best.Bit {
			best, found = r, true
		}
	}
	if found {
		return best
	}
	return rates[len(rates)-1]
}

// StreamURL 只取一条地址（给中继/录制用）：
// 与 pure_live 的 resolvePlayUrlAtRaw 一致，只请求指定线路。
func (c *Client) StreamURL(roomID, quality, line string) (string, error) {
	detail, err := c.FetchRoomDetail(roomID)
	if err != nil {
		return "", err
	}
	if !detail.IsLive {
		return "", fmt.Errorf("主播未开播")
	}

	rates, cdns, err := c.playQualities(detail.RealRoomID)
	if err != nil {
		return "", err
	}
	rate, ok := resolveRate(quality, rates)
	if !ok {
		rate = rates[0]
	}
	cdn := selectCDN(line, cdns)

	resolution, err := c.resolvePlayURL(detail.RealRoomID, rate.Rate, cdn)
	if err != nil {
		return "", err
	}
	if len(resolution.URLs) == 0 {
		return "", fmt.Errorf("斗鱼没有返回可用的直播流")
	}
	return resolution.URLs[0], nil
}
