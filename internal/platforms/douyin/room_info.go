package douyin

import (
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"

	"dtv/internal/platforms/common"
)

// 抖音房间信息与取流。
//
// 真实链路（实测得出，与旧实现不同）：
//  1. 打开房间 H5 页面 https://live.douyin.com/{web_rid}
//     → 收下 ttwid 等 cookie，并从页面内嵌 JSON 里读到**内部 roomId**
//  2. 用内部 roomId 调 https://webcast.amemv.com/webcast/room/reflow/info/
//     → 一次返回标题/主播/封面/开播状态 + 全部清晰度的 flv 地址
//
// 为什么不用旧实现的 webcast/room/web/enter：
// 实测该接口对当前参数组合稳定返回 **HTTP 200 + 空 body**（带签名、不带签名、
// 带 cookie、不带 cookie 全都一样），已经不可用；而 reflow 接口正常。
//
// 关键点：reflow 需要的是内部 roomId（19 位数字），**不是** web_rid（短号），
// 二者不能混用（混用会得到 "room_id invalid" / "app id and live id mismatch"）。

// urlReflow 是房间详情 + 取流接口。
const urlReflow = "https://webcast.amemv.com/webcast/room/reflow/info/"

// reflow 需要的固定参数（缺失会报 app id/live id mismatch）。
const (
	reflowTypeID      = "0"
	reflowVersionCode = "99.99.99"
	reflowAppID       = "1128"
)

// 请求被服务器拦截时房间页 HTML 里的特征字符
var blockedMarkers = []string{
	"verify_data",
	"验证码中间页",
}

// roomIDPattern 匹配页面内嵌 JSON 里的内部 roomId。
//
// 页面里的 JSON 是转义过的（形如 \"roomId\":\"7702034233618877218\"），
// 所以正则要按转义形式写。
var roomIDPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\\"roomId\\":\\"(\d{10,})\\"`),
	regexp.MustCompile(`"roomId":"(\d{10,})"`),
	regexp.MustCompile(`\\"room_id\\":\\"(\d{10,})\\"`),
}

// reflowResponse 是 reflow 接口的响应外壳。
type reflowResponse struct {
	StatusCode int             `json:"status_code"`
	Data       json.RawMessage `json:"data"`
	Extra      json.RawMessage `json:"extra"`
}

// reflowData 是 data 字段。
type reflowData struct {
	Room *reflowRoom `json:"room"`
}

// reflowRoom 是房间对象。
type reflowRoom struct {
	IDStr  string  `json:"id_str"`
	Title  string  `json:"title"`
	Status int     `json:"status"`
	Cover  urlList `json:"cover"`
	Owner  struct {
		Nickname    string  `json:"nickname"`
		AvatarThumb urlList `json:"avatar_thumb"`
	} `json:"owner"`
	Stats struct {
		TotalUserStr string `json:"total_user_str"`
		UserCountStr string `json:"user_count_str"`
	} `json:"stats"`
	// RoomViewStats 才是准确人数（display_value 是纯数字，stats.user_count_str 常为 "0"）
	RoomViewStats struct {
		DisplayValue int64  `json:"display_value"`
		DisplayShort string `json:"display_short"`
	} `json:"room_view_stats"`
	StreamURL *streamURL `json:"stream_url"`
}

// streamURL 是 stream_url 对象。
//
// 关键：**「原画」不在 flv_pull_url 里**。实测（2026-11）抖音的 flv_pull_url /
// hls_pull_url_map 只给 FULL_HD1 / HD1 / SD1 / SD2，真正的原画地址放在
// live_core_sdk_data.pull_data.stream_data 这段内嵌 JSON 的 data.origin.main.{flv,hls}，
// 编码参数在同级 sdk_params（JSON 字符串）的 VCodec 字段里。
// 旧 Tauri 版（src-tauri/src/platforms/douyin/web_api.rs 的 merge_origin_stream）
// 就是靠这段把 ORIGIN 补进 flv_pull_url 的，移植时漏掉了。
type streamURL struct {
	FlvPullURL map[string]string `json:"flv_pull_url"`
	HLSPullURL map[string]string `json:"hls_pull_url_map"`
	DefaultRes string            `json:"default_resolution"`
	// 新版接口：pull_data.stream_data
	LiveCoreSDKData *struct {
		PullData *struct {
			StreamData string `json:"stream_data"`
		} `json:"pull_data"`
	} `json:"live_core_sdk_data"`
	// 部分版本/接口：pull_datas[<key>].stream_data
	PullDatas map[string]*struct {
		StreamData string `json:"stream_data"`
	} `json:"pull_datas"`
}

// streamDataJSON 取内嵌的 stream_data 原始 JSON（两个来源都兼容）。
func (s *streamURL) streamDataJSON() string {
	if s == nil {
		return ""
	}
	if s.LiveCoreSDKData != nil && s.LiveCoreSDKData.PullData != nil {
		if raw := strings.TrimSpace(s.LiveCoreSDKData.PullData.StreamData); raw != "" {
			return raw
		}
	}
	// 各 key 的 stream_data 内容一致，取第一个非空的即可
	for _, entry := range s.PullDatas {
		if entry != nil {
			if raw := strings.TrimSpace(entry.StreamData); raw != "" {
				return raw
			}
		}
	}
	return ""
}

// tierStream 是 stream_data 里的一个清晰度档位（origin / uhd / hd / sd / ld / md / ao）。
type tierStream struct {
	FLV        string
	HLS        string
	Codec      string // sdk_params.VCodec：h264 / h265
	Fps        int
	Bitrate    int64
	Resolution string
}

// isHEVC 判断这一档是不是 H.265。
//
// WebView2（Chromium）对 HEVC 支持很不稳定：FLV 里的 HEVC（CodecID 12）基本进不了
// MSE，所以 HEVC 档不能当默认档位，要降级、并优先给 HLS（还能指望系统解码器）。
func (t *tierStream) isHEVC() bool {
	switch strings.ToLower(strings.TrimSpace(t.Codec)) {
	case "h265", "265", "hevc", "hvc1":
		return true
	default:
		return false
	}
}

// parseStreamData 把 stream_data 解析成「档位 key → 流」。
//
// 这份内嵌 JSON 才是清晰度的权威来源：
//   - flv_pull_url / hls_pull_url_map 里只有 FULL_HD1 / HD1 / SD1 / SD2 四个**转码档**，
//     原画根本不在里面（读 flv_pull_url["ORIGIN"] 永远落空）；
//   - 这里每一档都带服务端给的 sdk_params（VCodec / vbitrate / fps / resolution），
//     可以据此把画质阶梯排对、并判断编码是不是 HEVC。
//
// 实测（2026-11，多间房一致）阶梯为：origin 原画(≈20Mbps) > uhd 蓝光(8Mbps) >
// hd 超清(6Mbps) > sd 高清(2Mbps) > ld 标清(1Mbps) > md 流畅(0.8Mbps)。
func (s *streamURL) parseStreamData() map[string]*tierStream {
	raw := s.streamDataJSON()
	if raw == "" {
		return nil
	}
	var outer struct {
		Data map[string]struct {
			Main struct {
				FLV       string `json:"flv"`
				HLS       string `json:"hls"`
				SDKParams string `json:"sdk_params"`
			} `json:"main"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &outer); err != nil {
		log.Printf("[Douyin] 解析 stream_data 失败（清晰度退回 flv_pull_url）: %v", err)
		return nil
	}
	out := make(map[string]*tierStream, len(outer.Data))
	for key, entry := range outer.Data {
		flv := strings.TrimSpace(entry.Main.FLV)
		hls := strings.TrimSpace(entry.Main.HLS)
		if flv == "" && hls == "" {
			continue
		}
		item := &tierStream{FLV: flv, HLS: hls}
		if params := strings.TrimSpace(entry.Main.SDKParams); params != "" {
			var p struct {
				VCodec     string  `json:"VCodec"`
				Fps        int     `json:"fps"`
				Bitrate    float64 `json:"vbitrate"`
				Resolution string  `json:"resolution"`
			}
			if json.Unmarshal([]byte(params), &p) == nil {
				item.Codec = p.VCodec
				item.Fps = p.Fps
				item.Bitrate = int64(p.Bitrate)
				item.Resolution = p.Resolution
			}
		}
		out[key] = item
	}
	return out
}

// NormalizeRoomID 把用户输入的"房间号 / 直播间链接"统一成 web_rid（短号）。
//
// 支持：
//   - "933572413882"（纯数字）
//   - "https://live.douyin.com/933572413882"
//   - "https://live.douyin.com/933572413882?xxx"
//   - "www.douyin.com/follow/live/933572413882"
func NormalizeRoomID(input string) string {
	s := strings.TrimSpace(input)
	if s == "" {
		return ""
	}
	// 优先取 query 里显式给的房间号
	if i := strings.Index(s, "?"); i >= 0 {
		query := s[i+1:]
		for _, kv := range strings.Split(query, "&") {
			for _, key := range []string{"room_id=", "roomId=", "web_rid=", "webId="} {
				if strings.HasPrefix(kv, key) {
					v := strings.TrimPrefix(kv, key)
					if j := strings.IndexAny(v, "&#"); j >= 0 {
						v = v[:j]
					}
					if v != "" {
						return keepDigits(v)
					}
				}
			}
		}
		s = s[:i]
	}
	if i := strings.IndexAny(s, "#"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimRight(s, "/")
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	return keepDigits(s)
}

// keepDigits 只保留数字（抖音 web_rid 是纯数字）。
func keepDigits(s string) string {
	var b strings.Builder
	for _, ch := range s {
		if ch >= '0' && ch <= '9' {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// fetchRoomPage 打开房间 H5 页面：既拿到 cookie，也拿到内嵌的内部 roomId。
func (c *Client) fetchRoomPage(webRID string) (string, error) {
	target := urlLiveHome + webRID
	headers := map[string]string{
		"User-Agent":      desktopUA,
		"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "zh-CN,zh;q=0.9",
		"Referer":         urlLiveHome,
	}
	return c.http.GetText(target, headers)
}

// extractInternalRoomID 从页面 HTML 里读内部 roomId。
func extractInternalRoomID(html string) string {
	for _, re := range roomIDPatterns {
		if m := re.FindStringSubmatch(html); len(m) == 2 && m[1] != "" {
			return m[1]
		}
	}
	return ""
}

// fetchReflow 用内部 roomId 拉房间详情与取流地址。
func (c *Client) fetchReflow(internalRoomID string) (*reflowRoom, error) {
	params := [][2]string{
		{"type_id", reflowTypeID},
		{"live_id", paramLiveID},
		{"version_code", reflowVersionCode},
		{"app_id", reflowAppID},
		{"room_id", internalRoomID},
		{"msToken", GenerateMsToken(107)},
	}

	headers := map[string]string{
		"User-Agent":      desktopUA,
		"Referer":         urlLiveHome,
		"Accept":          "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9",
	}

	var resp reflowResponse
	if err := c.http.GetJSON(signedURL(urlReflow, params), headers, &resp); err != nil {
		return nil, err
	}

	var data reflowData
	if len(resp.Data) > 0 {
		if err := json.Unmarshal(resp.Data, &data); err != nil {
			return nil, fmt.Errorf("解析抖音房间数据失败: %w", err)
		}
	}
	if data.Room == nil {
		return nil, fmt.Errorf("抖音房间数据为空（status_code=%d）", resp.StatusCode)
	}
	return data.Room, nil
}

// roomBundle 是"房间页 + reflow"两步合并后的结果。
type roomBundle struct {
	WebRID     string
	InternalID string
	Room       *reflowRoom
}

// resolveRoom 拉一个房间的完整数据（页面 → 内部 id → reflow）。
func (c *Client) resolveRoom(roomID string) (*roomBundle, error) {
	webRID := NormalizeRoomID(roomID)
	if webRID == "" {
		return nil, common.Fatal("抖音房间号无效: %q", roomID)
	}

	html, err := c.fetchRoomPage(webRID)
	if err != nil {
		return nil, err
	}

	// log.Printf("[Douyin] 房间 %s 查找 roomId，页面内容：%s", webRID, html) // 开发时使用

	// 页面里出现以下任一标记说明请求被服务器拦截（风控/验证码）。
	for _, mark := range blockedMarkers {
		if strings.Contains(html, mark) {
			return nil, common.Fatal("本次请求受到服务器拦截，请稍后再试")
		}
	}

	internalID := extractInternalRoomID(html)
	if internalID == "" {
		// 页面结构变化时给出明确提示，比"请求失败"好排查
		return nil, common.Fatal("抖音房间 %s 页面里没有找到内部 roomId（房间可能不存在或页面结构变更）", webRID)
	}

	room, err := c.fetchReflow(internalID)
	if err != nil {
		return nil, err
	}

	return &roomBundle{WebRID: webRID, InternalID: internalID, Room: room}, nil
}

// flvQuality 是一个可用的清晰度档位。
type flvQuality struct {
	Key    string // 上游档位 key（origin / uhd / FULL_HD1 等）
	Label  string // 展示名
	ID     string // 前端稳定 id
	URL    string
	Format string // flv / hls
}

// douyinTiers 是抖音的画质阶梯，从高到低。
//
// key 取 stream_data.data 的键；中文名对齐服务端 options.qualities[].name
// （实测：ld=标清 / sd=高清 / hd=超清 / uhd=蓝光，origin=原画）。
// md（流畅）不进菜单，和旧版"别摆一档用户永远不点的最低画质"的取舍一致。
var douyinTiers = []struct {
	Key   string
	Label string
	ID    string
}{
	{"origin", "原画", "source"},
	{"uhd", "蓝光", "bluray"},
	{"hd", "超清", "high"},
	{"sd", "高清", "standard"},
	{"ld", "标清", "low"},
}

// flvPullKeyTier 把 flv_pull_url 的 key 映射到画质档位。
//
// 实测对应关系（同名文件后缀可交叉验证）：
//
//	FULL_HD1 → _uhd.flv（蓝光）
//	HD1      → _hd.flv （超清）
//	SD1      → _ld.flv （标清，1Mbps 720x540）  ← 名字里是 SD，实际是最低档
//	SD2      → _sd.flv （高清，2Mbps 960x720）
//
// 也就是 SD1/SD2 与中文名是"错位"的，旧代码按 SD1=高清、SD2=标清映射并且
// 把 SD2 当最低档删掉，等于把「高清」删了、把「标清」标成了「高清」。
// 现在优先用文件名后缀判定，判不出来才退回这张表。
var flvPullKeyTier = map[string]string{
	"FULL_HD1": "uhd",
	"HD1":      "hd",
	"SD1":      "ld",
	"SD2":      "sd",
}

// tierFromURL 从取流地址里判断画质档位。
//
// 后缀可能在文件名里（.../stream-1_uhd.flv），也可能在目录名里
// （HLS 的 .../stream-1_or4/index.m3u8），所以从路径最后一段往前找。
func tierFromURL(raw string) string {
	u := raw
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	segments := strings.Split(strings.Trim(u, "/"), "/")
	for i := len(segments) - 1; i >= 0 && i >= len(segments)-2; i-- {
		seg := segments[i]
		seg = strings.TrimSuffix(seg, ".flv")
		seg = strings.TrimSuffix(seg, ".m3u8")
		idx := strings.LastIndex(seg, "_")
		if idx < 0 {
			continue
		}
		switch suffix := seg[idx+1:]; suffix {
		case "or4", "origin":
			return "origin"
		case "uhd", "hd", "sd", "ld", "md":
			return suffix
		}
	}
	return ""
}

// tierLabel 返回档位的中文名（找不到就用 key 本身）。
func tierLabel(tier, fallback string) string {
	for _, t := range douyinTiers {
		if t.Key == tier {
			return t.Label
		}
	}
	if fallback != "" {
		return fallback
	}
	return tier
}

// tierID 返回档位的前端稳定 id。
func tierID(tier, fallback string) string {
	for _, t := range douyinTiers {
		if t.Key == tier {
			return t.ID
		}
	}
	return strings.ToLower(firstNonEmptyStr(fallback, tier))
}

func firstNonEmptyStr(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// tierQuality 把一个档位转成前端档位（HEVC 走 HLS、标签上标出来）。
func tierQuality(tier, label, id string, stream *tierStream) (flvQuality, bool) {
	if stream == nil {
		return flvQuality{}, false
	}
	hevc := stream.isHEVC()
	url, format := stream.FLV, "flv"
	if hevc && stream.HLS != "" {
		// FLV 里的 HEVC 基本进不了 MSE，优先给 HLS
		url, format = stream.HLS, "hls"
	}
	if url == "" {
		url, format = stream.HLS, "hls"
	}
	if url == "" {
		return flvQuality{}, false
	}
	if hevc {
		label = label + " · H.265"
	}
	return flvQuality{Key: tier, Label: label, ID: id, URL: url, Format: format}, true
}

// pickQualities 从房间数据里挑出可用清晰度，按画质从高到低排列。
//
// 优先用 stream_data（权威阶梯、带编码信息），它缺档时再用 flv_pull_url 补齐；
// 两者都没有才返回空。
func pickQualities(room *reflowRoom) []flvQuality {
	if room == nil || room.StreamURL == nil {
		return nil
	}
	su := room.StreamURL
	streams := su.parseStreamData()
	pullURL := su.FlvPullURL
	if len(streams) == 0 && len(pullURL) == 0 && len(su.HLSPullURL) == 0 {
		return nil
	}

	// 1) stream_data：每个档位直接用它的 flv/hls
	byTier := make(map[string]*tierStream, len(streams))
	for tier, stream := range streams {
		if tier == "ao" { // 纯音频通道，不进画质菜单
			continue
		}
		byTier[tier] = stream
	}

	// 2) flv_pull_url 兜底：老响应没有 stream_data，或者某档只在这里给
	for key, u := range pullURL {
		if strings.TrimSpace(u) == "" {
			continue
		}
		tier := tierFromURL(u)
		if tier == "" {
			tier = flvPullKeyTier[key]
		}
		if tier == "" || byTier[tier] != nil {
			continue
		}
		byTier[tier] = &tierStream{FLV: u}
	}
	for _, u := range su.HLSPullURL {
		if strings.TrimSpace(u) == "" {
			continue
		}
		tier := tierFromURL(u)
		if tier == "" || byTier[tier] != nil {
			continue
		}
		byTier[tier] = &tierStream{HLS: u}
	}

	// 3) 按画质阶梯输出；md（流畅）与非标准档位不摆进菜单
	out := make([]flvQuality, 0, len(byTier))
	for _, t := range douyinTiers {
		q, ok := tierQuality(t.Key, t.Label, t.ID, byTier[t.Key])
		if !ok {
			continue
		}
		out = append(out, q)
	}

	// 完全没有阶梯信息时，退回"最高可用档位叫原画"
	if len(out) == 0 {
		keys := make([]string, 0, len(pullURL))
		for k, v := range pullURL {
			if strings.TrimSpace(v) != "" {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			out = append(out, flvQuality{
				Key: k, Label: k, ID: strings.ToLower(k), URL: pullURL[k], Format: "flv",
			})
		}
		if len(out) > 0 {
			out[0].Label = "原画"
		}
	}

	return out
}

// originTierKey 取原画档的 key（阶梯里 origin 一定排第一，但兜底路径可能是别的键）。
const originTierKey = "origin"

// h264OriginForHEVC 在「原画是 H.265」时，额外探一路 H.264 原画。
//
// 抖音 CDN 支持 codec 查询参数（旧 Tauri 版一直给 origin 追加 `&codec=<VCodec>`），
// 但不同房间/边缘节点不一定真的按参数转码，所以这里**实测 Flv CodecID**：
// 只有确实拿到 H.264 才多给一档，否则菜单里会出现两个一模一样的 HEVC 档。
//
// 动机：部分设备（WebView2 + 系统缺 HEVC 解码器）放不了 H.265 直播流，
// 而「原画 · H.264」和原画是同画质档位，能直接对比/兜底。
func (c *Client) h264OriginForHEVC(origin *tierStream) (*flvQuality, bool) {
	if origin == nil || !origin.isHEVC() || origin.FLV == "" {
		return nil, false
	}
	probe := origin.FLV + "&codec=h264"
	codec, err := flvCodecSniffer(probe)
	if err != nil {
		log.Printf("[Douyin] 探测 H.264 原画失败（保留原样）: %v", err)
		return nil, false
	}
	if codec != "h264" {
		log.Printf("[Douyin] codec=h264 仍返回 %s，不额外提供 H.264 原画", codec)
		return nil, false
	}
	log.Printf("[Douyin] 原画是 H.265，但 codec=h264 能拿到 H.264 原画，已并行提供")
	return &flvQuality{
		Key:    "origin-h264",
		Label:  "原画 · H.264",
		ID:     "source",
		URL:    probe,
		Format: "flv",
	}, true
}

// orderForPlayback 调整档位顺序，保证第一个（默认档）在 WebView2 上能播。
//
//   - 原画是 H.264：阶梯原样返回；
//   - 原画是 H.265 且探到了 H.264 原画：默认档给「原画 · H.264」，
//     原来那档改 id 成 source-h265 留在第二位（想对比画质可以直接切）；
//   - 原画是 H.265 且没有 H.264 原画：把 H.265 原画挪到第二位，
//     默认档退回最高的 H.264 转码档（蓝光）。
func (c *Client) orderForPlayback(streams map[string]*tierStream, ladder []flvQuality) []flvQuality {
	if len(ladder) == 0 {
		return ladder
	}
	origin := streams[originTierKey]
	if origin == nil || !origin.isHEVC() {
		return ladder
	}

	sibling, ok := c.h264OriginForHEVC(origin)
	if ok {
		// 原画(H.265) 让出 source id，保留在第二位供对比
		out := make([]flvQuality, 0, len(ladder)+1)
		out = append(out, *sibling)
		for _, q := range ladder {
			if q.Key == originTierKey {
				q.ID = "source-h265"
				q.Label = "原画 · H.265"
			}
			out = append(out, q)
		}
		return out
	}

	// 没有 H.264 原画：把 H.265 挪到第二位（标签补上编码，别让它顶替默认档）
	for i, q := range ladder {
		if q.Key != originTierKey || i == 1 {
			continue
		}
		q.Label = "原画 · H.265"
		rest := make([]flvQuality, 0, len(ladder))
		rest = append(rest, ladder[:i]...)
		rest = append(rest, ladder[i+1:]...)
		pos := 1
		if len(rest) < pos {
			pos = len(rest)
		}
		rest = append(rest, flvQuality{})
		copy(rest[pos+1:], rest[pos:])
		rest[pos] = q
		return rest
	}
	return ladder
}

// viewersOf 取房间人数。
//
// 优先级：room_view_stats.display_value（精确数字）
//
//	→ stats.user_count_str（可能是 "0"）
//	→ stats.total_user_str（"10万+" 这类文案）
func viewersOf(room *reflowRoom) int64 {
	if room == nil {
		return 0
	}
	if room.RoomViewStats.DisplayValue > 0 {
		return room.RoomViewStats.DisplayValue
	}

	text := room.Stats.UserCountStr
	if text == "" || text == "0" {
		text = room.Stats.TotalUserStr
	}
	return parseViewerText(text)
}

// Streamer 拉房间卡片信息（不含取流）。
func (c *Client) Streamer(roomID string) (common.Streamer, error) {
	bundle, err := c.resolveRoom(roomID)
	if err != nil {
		return common.Streamer{}, err
	}
	room := bundle.Room

	return common.Streamer{
		ID:       bundle.WebRID,
		Platform: string(common.PlatformDouyin),
		Nickname: room.Owner.Nickname,
		Title:    room.Title,
		Cover:    room.Cover.first(),
		Avatar:   room.Owner.AvatarThumb.first(),
		Viewers:  viewersOf(room),
		IsLive:   isRoomLive(room),
	}, nil
}

// isRoomLive 判断是否在播。
//
// 对齐旧项目（web/src/platforms/douyin + FollowsList 的 refreshOne）：
// reflow 接口的 room.status 语义是 2=直播中、4=已结束/未开播，因此**以 status 为准**。
// 之前用"有没有 flv 地址"当硬标准，下播后上游仍会回一段（过期的）flv 地址，
// 于是关注列表刷新完还是显示"直播中"。
// 只有在 status 缺失（0）时才退回 flv 地址做兜底。
func isRoomLive(room *reflowRoom) bool {
	if room == nil {
		return false
	}
	switch room.Status {
	case 2:
		return true
	case 0:
		return len(pickQualities(room)) > 0
	default:
		return false
	}
}

// StreamInfo 组装播放页数据：房间信息 + 全部清晰度。
//
// 抖音没有"多线路"概念（flv_pull_url 里每个 key 就是一个清晰度），
// 所以 Lines 恒为空，清晰度全部由 Variants 承担。
func (c *Client) StreamInfo(roomID, line string) (*common.StreamInfo, error) {
	bundle, err := c.resolveRoom(roomID)
	if err != nil {
		return nil, err
	}
	room := bundle.Room

	info := &common.StreamInfo{
		RoomID:   bundle.WebRID,
		Platform: string(common.PlatformDouyin),
		Title:    room.Title,
		Nickname: room.Owner.Nickname,
		Avatar:   room.Owner.AvatarThumb.first(),
		IsLive:   isRoomLive(room),
		Variants: []common.StreamVariant{},
		Lines:    []common.LineOption{},
	}

	if !info.IsLive {
		return info, nil
	}

	quals := c.orderForPlayback(room.StreamURL.parseStreamData(), pickQualities(room))
	for _, q := range quals {
		format := q.Format
		if format == "" {
			format = "flv"
		}
		info.Variants = append(info.Variants, common.StreamVariant{
			ID:     q.ID,
			Label:  q.Label,
			URL:    enforceHTTPSURL(q.URL),
			Format: format,
		})
	}

	if len(info.Variants) == 0 {
		return info, fmt.Errorf("抖音房间 %s 没有可用清晰度", bundle.WebRID)
	}

	// 抖音没有线路概念，line 保留只是为了接口契约一致
	_ = line
	return info, nil
}

// StreamURL 只取一条播放地址。
//
// quality 支持中文（原画/蓝光/超清/高清/标清）、稳定 id（source/bluray/high/
// standard/low）以及上游 key（FULL_HD1 等）；找不到就退回最高清晰度。
func (c *Client) StreamURL(roomID, quality, line string) (string, error) {
	info, err := c.StreamInfo(roomID, line)
	if err != nil {
		return "", err
	}
	if !info.IsLive || len(info.Variants) == 0 {
		return "", fmt.Errorf("抖音房间 %s 当前未开播", roomID)
	}

	target := strings.TrimSpace(quality)
	if target == "" {
		return info.Variants[0].URL, nil
	}

	for _, v := range info.Variants {
		if strings.EqualFold(v.ID, target) || v.Label == target ||
			strings.EqualFold(v.ID, strings.ToLower(target)) {
			return v.URL, nil
		}
	}
	return info.Variants[0].URL, nil
}

// enforceHTTPSURL 把 http 播放地址升到 https（抖音也会返回 http）。
func enforceHTTPSURL(raw string) string {
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}
