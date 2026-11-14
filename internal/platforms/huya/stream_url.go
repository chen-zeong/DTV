package huya

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"dtv/internal/platforms/common"
)

// 常量与旧 stream_url.rs / danmaku.rs 保持一致。
const (
	// profileRoom 接口（房间档案 + 取流候选），旧实现两处都用它。
	urlProfileRoom = "https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=%s&showSecret=1"

	// WUP（TARS RPC）网关，用来拿 CDN token。
	urlWup = "http://wup.huya.com"

	// WUP 请求头里的 UA / Origin / Referer（旧实现照抄 pure_live）。
	huyaHysdkUA = "HYSDK(Windows,30000002)_APP(pc_exe&7080000&official)_SDK(trans&2.34.0.5795)"
	wupOrigin   = "https://m.huya.com/"
	wupReferer  = "https://m.huya.com/"

	// firefoxUA 是旧实现 profileRoom 用的 UA（与列表接口的 Chrome UA 不同）。
	firefoxUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"

	// WUP 服务名与方法名。
	wupServant  = "liveui"
	wupFuncName = "getCdnTokenInfoEx"

	// 请求里的固定 appId 与客户端标识（旧实现写死）。
	wupAppID    = 66
	wupHyuaUA   = "pc_exe&7060000&official"
	wupLoopTime = 0
)

/* --------------------------------------------------------- 房间档案（profile） */

// profileResponse 只声明用到的字段。
type profileResponse struct {
	Status int             `json:"status"`
	Data   json.RawMessage `json:"data"`
}

// profileData 是 data 里用到的部分。
type profileData struct {
	LiveData struct {
		Introduction string  `json:"introduction"`
		RoomName     string  `json:"roomName"`
		Nick         string  `json:"nick"`
		Avatar180    string  `json:"avatar180"`
		BitRateInfo  string  `json:"bitRateInfo"`
		UID          flexInt `json:"uid"`     // 虎牙有时返回字符串，有时返回数字
		Channel      flexInt `json:"channel"` // 同上
	} `json:"liveData"`
	ProfileInfo struct {
		Nick      string  `json:"nick"`
		Avatar180 string  `json:"avatar180"`
		Yyid      flexInt `json:"yyid"` // 同上
	} `json:"profileInfo"`
	Stream *struct {
		BaseStreamInfoList []streamCandidateJSON `json:"baseSteamInfoList"`
		Flv                struct {
			RateArray []struct {
				BitRate int32 `json:"iBitRate"`
			} `json:"rateArray"`
		} `json:"flv"`
	} `json:"stream"`
}

// streamCandidateJSON 是 baseSteamInfoList 的一条（字段名拼写错误是虎牙自己的）。
type streamCandidateJSON struct {
	CdnType     string  `json:"sCdnType"`
	FlvURL      string  `json:"sFlvUrl"`
	StreamName  string  `json:"sStreamName"`
	ChannelID   flexInt `json:"lChannelId"`
	FlvAntiCode string  `json:"sFlvAntiCode"`
}

// flexInt 兼容虎牙返回的 2.367547387e+09 这类浮点大整数。
type flexInt int64

func (f *flexInt) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	if s == "null" || s == "" {
		*f = 0
		return nil
	}
	if len(s) > 1 && (s[0] == '"') {
		s = strings.Trim(s, `"`)
	}
	if v, err := strconv.ParseInt(s, 10, 64); err == nil {
		*f = flexInt(v)
		return nil
	}
	// 浮点形式：float64 尾数足够覆盖虎牙的 channelId（< 2^53）
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		*f = flexInt(int64(v))
		return nil
	}
	*f = 0
	return nil
}

// fetchProfile 拉房间档案。
func (c *Client) fetchProfile(roomID string) (*profileData, error) {
	target := fmt.Sprintf(urlProfileRoom, url.QueryEscape(roomID))
	headers := map[string]string{
		"User-Agent": firefoxUA,
		"Referer":    referer,
		"Origin":     "https://www.huya.com",
		"Accept":     "*/*",
	}

	body, err := c.http.GetText(target, headers)
	if err != nil {
		return nil, err
	}

	var resp profileResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil, fmt.Errorf("解析虎牙房间档案失败: %w", err)
	}
	if resp.Status != 200 {
		return nil, fmt.Errorf("虎牙房间档案返回 status=%d（房间可能不存在）", resp.Status)
	}

	var data profileData
	if len(resp.Data) > 0 {
		if err := json.Unmarshal(resp.Data, &data); err != nil {
			return nil, fmt.Errorf("解析虎牙 data 失败: %w", err)
		}
	}
	return &data, nil
}

/* --------------------------------------------------------------- anti-code */

// buildAntiCode 用 WUP 拿到的 token 重新构造播放地址的鉴权串。
//
// 这是旧 build_huya_anti_code 的逐行移植（对齐 pure_live）：
//
//	seqid      = presenterUID + 当前毫秒
//	secretHash = md5("seqid|ctype|platformId")
//	wsSecret   = md5("<fm 前缀>_<calcUid>_<streamName>_<secretHash>_<wsTime>")
//
// 其中 fm 前缀来自上游 token 里的 fm（base64 解码后按 '_' 切第一段）。
func buildAntiCode(streamName string, presenterUID int64, token string) (string, error) {
	sanitized := strings.ReplaceAll(token, "&amp;", "&")
	trimmed := strings.TrimLeft(sanitized, "?&")

	params, err := url.ParseQuery(trimmed)
	if err != nil {
		return "", fmt.Errorf("解析 anti-code 失败: %w", err)
	}

	fm := params.Get("fm")
	if fm == "" {
		// 上游已经给了可用的 query，直接用
		return trimmed, nil
	}

	ctype := params.Get("ctype")
	if ctype == "" {
		ctype = "huya_pc_exe"
	}

	platformID, _ := strconv.ParseInt(params.Get("t"), 10, 64)
	isWap := platformID == 103

	calcStart := currentMillis()
	seqID := presenterUID + calcStart
	secretHash := md5Hex(fmt.Sprintf("%d|%s|%d", seqID, ctype, platformID))

	convertUID := rotl32By8(presenterUID)
	calcUID := convertUID
	if isWap {
		calcUID = presenterUID
	}

	fmDecoded, err := url.QueryUnescape(fm)
	if err != nil {
		return "", fmt.Errorf("fm 解码失败: %w", err)
	}
	fmPlain, err := base64StdDecode(fmDecoded)
	if err != nil {
		return "", fmt.Errorf("fm base64 解码失败: %w", err)
	}
	secretPrefix := strings.SplitN(string(fmPlain), "_", 2)[0]
	if secretPrefix == "" {
		return "", fmt.Errorf("无法从 fm 推导 wsSecret 前缀")
	}

	wsTime := params.Get("wsTime")
	if wsTime == "" {
		return "", fmt.Errorf("anti-code 缺少 wsTime")
	}

	secretStr := fmt.Sprintf("%s_%d_%s_%s_%s", secretPrefix, calcUID, streamName, secretHash, wsTime)
	wsSecret := md5Hex(secretStr)

	fs := params.Get("fs")
	if fs == "" {
		return "", fmt.Errorf("anti-code 缺少 fs")
	}

	wsTimeInt, _ := strconv.ParseInt(strings.TrimSpace(wsTime), 16, 64)
	ct := int64((float64(wsTimeInt) + rand.Float64()) * 1000)
	uuid := uint32((float64(ct%10000000000) + rand.Float64()) * 1000)
	uuid %= 0xFFFFFFFF

	parts := make([]string, 0, 10)
	add := func(k, v string) { parts = append(parts, k+"="+v) }
	add("wsSecret", wsSecret)
	add("wsTime", wsTime)
	add("seqid", strconv.FormatInt(seqID, 10))
	add("ctype", ctype)
	add("ver", "1")
	add("fs", fs)
	add("fm", url.QueryEscape(fm))
	add("t", strconv.FormatInt(platformID, 10))
	if isWap {
		add("uid", strconv.FormatInt(presenterUID, 10))
		add("uuid", strconv.FormatUint(uint64(uuid), 10))
	} else {
		add("u", strconv.FormatInt(convertUID, 10))
	}
	return strings.Join(parts, "&"), nil
}

/* ------------------------------------------------------------------ WUP 调用 */

// encodeWupRequest 组装 TARS 请求包（对齐旧 encode_tars_request_packet）。
func encodeWupRequest(requestID int32, servant, fn string, tupPayload []byte) []byte {
	w := newTarsWriter()
	w.writeInt16(1, 3)  // iVersion
	w.writeInt8(2, 0)   // cPacketType
	w.writeInt32(3, 0)  // iMessageType
	w.writeInt32(4, requestID)
	w.writeString(5, servant)
	w.writeString(6, fn)
	w.writeBytes(7, tupPayload)
	w.writeInt32(8, 0) // iTimeout
	w.writeEmptyMap(9)
	w.writeEmptyMap(10)

	body := w.bytes()
	total := uint32(len(body) + 4)
	out := make([]byte, 0, len(body)+4)
	out = append(out, byte(total>>24), byte(total>>16), byte(total>>8), byte(total))
	return append(out, body...)
}

// getCdnToken 调 WUP 的 getCdnTokenInfoEx，拿播放鉴权 token。
func (c *Client) getCdnToken(flvURL, streamName string) (string, error) {
	// 1) tReq 结构体（GetCdnTokenExReq）
	req := newTarsWriter()
	req.writeStructBegin(0)
	req.writeString(0, flvURL)
	req.writeString(1, streamName)
	req.writeInt32(2, wupLoopTime)
	req.writeStructBegin(3) // HuyaUserId
	req.writeInt64(0, 0)
	req.writeString(1, "")
	req.writeString(2, "")
	req.writeString(3, wupHyuaUA)
	req.writeString(4, "")
	req.writeInt32(5, 0)
	req.writeString(6, "")
	req.writeString(7, "")
	req.writeStructEnd()
	req.writeInt32(4, wupAppID)
	req.writeStructEnd()
	reqBytes := req.bytes()

	// 2) UniAttribute：map<string,bytes>{"tReq": reqBytes}
	tup := newTarsWriter()
	tup.writeBytesMap(0, "tReq", reqBytes)

	packet := encodeWupRequest(1, wupServant, wupFuncName, tup.bytes())

	httpReq, err := newPostRequest(urlWup, packet)
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("User-Agent", huyaHysdkUA)
	httpReq.Header.Set("Origin", wupOrigin)
	httpReq.Header.Set("Referer", wupReferer)
	httpReq.Header.Set("Accept", "*/*")
	httpReq.Header.Set("Content-Type", "application/octet-stream")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := readAllLimited(resp.Body, 4096)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("虎牙 WUP HTTP %d: %s", resp.StatusCode, truncate(string(body), 120))
	}

	ret, payload, desc := decodeWupResponse(body)
	if ret != 0 {
		if desc == "" {
			return "", fmt.Errorf("虎牙 WUP 返回 ret=%d", ret)
		}
		return "", fmt.Errorf("虎牙 WUP 返回 ret=%d: %s", ret, desc)
	}

	token, err := decodeTokenFromTup(payload)
	if err != nil {
		return "", err
	}
	if token == "" {
		return "", fmt.Errorf("虎牙 WUP 没有返回可用 token")
	}
	return token, nil
}

// decodeWupResponse 解开 4 字节长度前缀 + ResponsePacket。
//
// 返回 (ret, tupPayload, resultDesc)。
func decodeWupResponse(buf []byte) (int32, []byte, string) {
	payload := buf
	if len(buf) >= 4 {
		declared := int(uint32(buf[0])<<24 | uint32(buf[1])<<16 | uint32(buf[2])<<8 | uint32(buf[3]))
		if declared >= 4 && declared <= len(buf) {
			payload = buf[4:declared]
		}
	}

	// 标准 ResponsePacket 布局：iRet(5) + sBuffer(6) + status(7) + sResultDesc(8)
	//
	// 注意：不能先用 find(1) 做"布局探测"——find 只定位头部不消费值，
	// 会让后续 find 落在上一个字段的值中间，解析整体错位。
	// 这里直接按 tag 升序读取，每个读取函数都会消费掉自己的值。
	r := newTarsReader(payload)
	ret := r.readInt32Tag(5, -1)
	if sBuffer, err := r.readBytesTag(6); err == nil {
		desc := r.readStringTag(8, "")
		return ret, sBuffer, desc
	}

	// 退化布局（虎牙 WUP 有时回"请求式"包）：sBuffer 在 tag 7
	r2 := newTarsReader(payload)
	if sBuffer, err := r2.readBytesTag(7); err == nil {
		return 0, sBuffer, ""
	}

	return -1, nil, ""
}

// decodeTokenFromTup 从 UniAttribute 里取出 flvToken。
//
// 兼容两种布局：map<string,bytes> 与 map<string,map<string,bytes>>。
func decodeTokenFromTup(payload []byte) (string, error) {
	if len(payload) == 0 {
		return "", fmt.Errorf("虎牙 WUP 返回空 payload")
	}

	if m, ok := decodeStringBytesMap(payload); ok {
		if v, exists := m["tRsp"]; exists {
			if token := decodeTokenStruct(v); token != "" {
				return token, nil
			}
		}
	}

	// 复杂布局：tRsp → map<string,bytes>
	r := newTarsReader(payload)
	outer, ok := decodeStringBytesMapReader(r)
	if !ok {
		return "", fmt.Errorf("无法解析虎牙 WUP 响应")
	}
	inner, exists := outer["tRsp"]
	if !exists {
		return "", fmt.Errorf("虎牙 WUP 响应缺少 tRsp")
	}
	if m, ok := decodeStringBytesMap(inner); ok {
		if v, ok2 := m["GetCdnTokenExResp"]; ok2 {
			if token := decodeTokenStruct(v); token != "" {
				return token, nil
			}
		}
		for _, v := range m {
			if token := decodeTokenStruct(v); token != "" {
				return token, nil
			}
		}
	}
	if token := decodeTokenStruct(inner); token != "" {
		return token, nil
	}
	return "", nil
}

// decodeStringBytesMap 解 map<string, bytes>。
func decodeStringBytesMap(payload []byte) (map[string][]byte, bool) {
	return decodeStringBytesMapReader(newTarsReader(payload))
}

func decodeStringBytesMapReader(r *tarsReader) (map[string][]byte, bool) {
	head, err := r.takeHead()
	if err != nil || head.typ != tMaps {
		return nil, false
	}
	count := int(r.readInt32(0, 0))
	if count < 0 || count > 64 {
		return nil, false
	}
	out := make(map[string][]byte, count)
	for i := 0; i < count; i++ {
		key := r.readStringTag(0, "")
		value, err := r.readBytesTag(1)
		if err != nil {
			return nil, false
		}
		out[key] = value
	}
	return out, true
}

// decodeTokenStruct 解 GetCdnTokenExResp（tag0 = sFlvToken）。
func decodeTokenStruct(payload []byte) string {
	r := newTarsReader(payload)
	if err := r.readStructBegin(0); err != nil {
		return ""
	}
	return strings.TrimSpace(r.readStringTag(0, ""))
}

/* ------------------------------------------------------------------ 取流 */

// rateVariant 一个清晰度档位。
type rateVariant struct {
	quality string // 原画 / 高清 / 标清
	id      string // source / high / standard
	bitRate int32
	label   string
}

// parseCandidates 从档案里提取候选线路（按旧实现的优先级排序）。
func parseCandidates(data *profileData) []streamCandidateJSON {
	if data == nil || data.Stream == nil {
		return nil
	}

	list := make([]streamCandidateJSON, 0, len(data.Stream.BaseStreamInfoList))
	fallbackUID := int64(0)
	if len(data.Stream.BaseStreamInfoList) > 0 {
		fallbackUID = int64(data.Stream.BaseStreamInfoList[0].ChannelID)
	}

	for _, item := range data.Stream.BaseStreamInfoList {
		if item.CdnType == "" || item.FlvURL == "" || item.StreamName == "" {
			continue
		}
		if item.ChannelID == 0 && fallbackUID != 0 {
			item.ChannelID = flexInt(fallbackUID)
		}
		if item.ChannelID == 0 {
			continue
		}
		list = append(list, item)
	}

	sort.SliceStable(list, func(i, j int) bool {
		return cdnPriority(list[i].CdnType) < cdnPriority(list[j].CdnType)
	})
	return list
}

// cdnPriority 线路优先级：tx > al > hs > 其它（与旧实现一致）。
func cdnPriority(cdn string) int {
	switch strings.ToLower(cdn) {
	case "tx":
		return 0
	case "al":
		return 1
	case "hs":
		return 2
	default:
		return 3
	}
}

// availableBitrates 取出可用码率（优先 liveData.bitRateInfo，其次 stream.flv.rateArray）。
func availableBitrates(data *profileData) []int32 {
	if data == nil {
		return nil
	}

	out := make([]int32, 0, 4)
	if data.LiveData.BitRateInfo != "" {
		var arr []struct {
			BitRate int32 `json:"iBitRate"`
		}
		if err := json.Unmarshal([]byte(data.LiveData.BitRateInfo), &arr); err == nil {
			for _, item := range arr {
				if item.BitRate > 0 {
					out = append(out, item.BitRate)
				}
			}
		}
	}

	if len(out) == 0 && data.Stream != nil {
		for _, item := range data.Stream.Flv.RateArray {
			if item.BitRate > 0 {
				out = append(out, item.BitRate)
			}
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	// 去重
	deduped := out[:0]
	for i, v := range out {
		if i == 0 || v != out[i-1] {
			deduped = append(deduped, v)
		}
	}
	return deduped
}

// buildVariants 生成清晰度列表（原画 / 高清 / 标清）。
//
// 与旧实现一致：高清取最大码率、标清取最小码率、原画不带 ratio。
func buildVariants(bitrates []int32) []rateVariant {
	hd := int32(4000)
	sd := int32(2000)
	if len(bitrates) > 0 {
		hd = bitrates[len(bitrates)-1]
		sd = bitrates[0]
	}

	return []rateVariant{
		{quality: "原画", id: "source", bitRate: 0, label: "原画"},
		{quality: "高清", id: "high", bitRate: hd, label: fmt.Sprintf("高清 %dK", hd)},
		{quality: "标清", id: "standard", bitRate: sd, label: fmt.Sprintf("标清 %dK", sd)},
	}
}

// resolveQuality 把前端传来的清晰度标识换算成码率（nil=原画，即不带 ratio）。
func resolveQuality(quality string, bitrates []int32) *int32 {
	q := strings.TrimSpace(quality)
	lower := strings.ToLower(q)

	hd := int32(4000)
	sd := int32(2000)
	if len(bitrates) > 0 {
		hd = bitrates[len(bitrates)-1]
		sd = bitrates[0]
	}

	switch {
	case q == "", lower == "source" || strings.Contains(q, "原画"):
		return nil
	case lower == "high" || strings.Contains(q, "高清") || lower == "hd":
		return &hd
	case lower == "standard" || strings.Contains(q, "标清") || lower == "sd" || lower == "ld":
		return &sd
	}
	// 也接受直接给码率数字
	if n, err := strconv.ParseInt(q, 10, 32); err == nil && n > 0 {
		v := int32(n)
		return &v
	}
	return &hd
}

// selectCandidate 按线路选择候选（找不到就用第一条）。
func selectCandidate(candidates []streamCandidateJSON, line string) streamCandidateJSON {
	target := strings.ToLower(strings.TrimSpace(line))
	if target != "" {
		for _, item := range candidates {
			if strings.ToLower(item.CdnType) == target {
				return item
			}
		}
	}
	return candidates[0]
}

// buildStreamURL 拼出最终播放地址（含 anti-code 与 codec 参数）。
func (c *Client) buildStreamURL(candidate streamCandidateJSON, ratio *int32) (string, error) {
	token, err := c.getCdnToken(candidate.FlvURL, candidate.StreamName)
	if err != nil {
		return "", err
	}
	anti, err := buildAntiCode(candidate.StreamName, int64(candidate.ChannelID), token)
	if err != nil {
		return "", err
	}

	base := strings.TrimRight(candidate.FlvURL, "/") + "/" + candidate.StreamName + ".flv?" + anti + "&codec=264"
	base = enforceHTTPS(base)
	if ratio != nil {
		return base + "&ratio=" + strconv.FormatInt(int64(*ratio), 10), nil
	}
	return base, nil
}

// Streamer 拉单个房间的卡片信息（不含取流）。
func (c *Client) Streamer(roomID string) (common.Streamer, error) {
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}
	data, err := c.fetchProfile(roomID)
	if err != nil {
		return common.Streamer{}, err
	}

	nick := firstNonEmpty(data.ProfileInfo.Nick, data.LiveData.Nick)
	if nick == "" {
		nick = "房间 " + roomID
	}
	avatar := firstNonEmpty(data.ProfileInfo.Avatar180, data.LiveData.Avatar180)

	return common.Streamer{
		ID:           roomID,
		Platform:     string(common.PlatformHuya),
		Nickname:     nick,
		Title:        firstNonEmpty(data.LiveData.Introduction, data.LiveData.RoomName),
		Avatar:       avatar,
		CategoryName: "", // 档案里没有分区名，由调用方按需补
		IsLive:       data.Stream != nil || len(parseCandidates(data)) > 0,
	}, nil
}

// StreamInfo 组装播放页数据：房间信息 + 全部清晰度 + 全部线路。
//
// 与斗鱼不同，虎牙每个清晰度档位只是同一个地址加 &ratio=N，
// 因此这里一次算出所有档位（每个档位都要各自去取一次 token，
// token 与清晰度无关，所以只取一次 token 复用即可）。
func (c *Client) StreamInfo(roomID, line string) (*common.StreamInfo, error) {
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}

	data, err := c.fetchProfile(roomID)
	if err != nil {
		return nil, err
	}

	candidates := parseCandidates(data)
	nick := firstNonEmpty(data.ProfileInfo.Nick, data.LiveData.Nick)
	title := firstNonEmpty(data.LiveData.Introduction, data.LiveData.RoomName)
	avatar := firstNonEmpty(data.ProfileInfo.Avatar180, data.LiveData.Avatar180)

	info := &common.StreamInfo{
		RoomID:   roomID,
		Platform: string(common.PlatformHuya),
		Title:    title,
		Nickname: nick,
		Avatar:   avatar,
		IsLive:   len(candidates) > 0,
		Lines:    make([]common.LineOption, 0, len(candidates)),
		Variants: []common.StreamVariant{},
	}

	for _, candidate := range candidates {
		info.Lines = append(info.Lines, common.LineOption{
			ID:    strings.ToLower(candidate.CdnType),
			Label: strings.ToUpper(candidate.CdnType),
		})
	}

	if !info.IsLive {
		// 未开播：返回房间信息但没有任何可播档位（前端会显示"未开播"）
		return info, nil
	}

	selected := selectCandidate(candidates, line)
	bitrates := availableBitrates(data)
	variants := buildVariants(bitrates)

	// token 与清晰度无关：取一次，再给每个档位拼不同 ratio
	for _, variant := range variants {
		var ratio *int32
		if variant.id != "source" {
			rate := variant.bitRate
			ratio = &rate
		}
		streamURL, err := c.buildStreamURL(selected, ratio)
		if err != nil {
			// 单个档位失败不影响其它档位（例如上游偶发 token 失败）
			continue
		}
		info.Variants = append(info.Variants, common.StreamVariant{
			ID:     variant.id,
			Label:  variant.label,
			URL:    streamURL,
			Format: "flv",
		})
	}

	if len(info.Variants) == 0 {
		return info, fmt.Errorf("虎牙取流失败：没有可用清晰度")
	}
	return info, nil
}

// StreamURL 只要一条播放地址。
func (c *Client) StreamURL(roomID, quality, line string) (string, error) {
	if roomID == "" {
		return "", fmt.Errorf("缺少房间号")
	}

	data, err := c.fetchProfile(roomID)
	if err != nil {
		return "", err
	}
	candidates := parseCandidates(data)
	if len(candidates) == 0 {
		return "", fmt.Errorf("房间当前未开播")
	}

	selected := selectCandidate(candidates, line)
	ratio := resolveQuality(quality, availableBitrates(data))
	return c.buildStreamURL(selected, ratio)
}

/* ------------------------------------------------------------------ 小工具 */

// md5Hex 返回小写十六进制 MD5。
func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// currentMillis 当前毫秒时间戳（anti-code 的 seqid 基准）。
func currentMillis() int64 { return time.Now().UnixMilli() }

// rotl32By8 把 32 位部分循环左移 8 位（对齐旧 rotl32_by8_in_i64）。
func rotl32By8(value int64) int64 {
	low := uint32(uint64(value) & 0xFFFFFFFF)
	rotated := low<<8 | low>>24
	high := value & ^int64(0xFFFFFFFF)
	return high | int64(rotated)
}

// enforceHTTPS 上游给的是 http://，桌面端统一用 https。
func enforceHTTPS(raw string) string {
	if strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}

// base64StdDecode 标准 base64 解码（fm 字段是标准 base64）。
func base64StdDecode(s string) ([]byte, error) {
	// 兼容 URL-safe 变体
	std := strings.NewReplacer("-", "+", "_", "/").Replace(s)
	if m := len(std) % 4; m != 0 {
		std += strings.Repeat("=", 4-m)
	}
	return stdBase64.DecodeString(std)
}
