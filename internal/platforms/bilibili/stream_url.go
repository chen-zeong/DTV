package bilibili

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"dtv/internal/platforms/common"
)

// stream_url.go 负责"房间 → 可播地址"。
//
// 实测结论（2026-10-30）：
//   - 该接口一次只返回 **一个 qn** 的地址（base_url 里是码率不是 qn），
//     所以每个清晰度都要单独请求一次；这里并发拉取，控制在 6 档以内。
//   - FLV 直连实测 404（带不带 Referer 都一样），HLS（.m3u8）直连 200 且
//     首行就是 #EXTM3U，**不需要 Referer**。所以本项目只暴露 HLS 档位。
//   - 旧实现给 FLV 起了一个本地代理来补 Referer，本架构没有代理层，
//     改用 HLS 后完全不需要，反而更简单。

// qn 常量（B 站直播清晰度）。
const (
	qnDolby = 30000 // 杜比
	qn4K    = 20000 // 4K
	qn2K    = 15000 // 2K
	qnOrigin = 10000 // 原画
	qnBluray = 400   // 蓝光
	qnUltra  = 250   // 超清
	qnHigh   = 150   // 高清
	qnSmooth = 80    // 流畅
)

// 前端只展示 5 档（与其它平台的档位说法保持一致），其余高端档位并入"原画"。
var preferredQNOrder = []int64{qnOrigin, qnBluray, qnUltra, qnHigh, qnSmooth}

// maxVariantFetch 并发上限，避免一次性打 8 个请求把上游惹毛。
const maxVariantFetch = 4

// playURL 是 playinfo 里解析出的一个可播地址。
type playURL struct {
	URL      string
	Format   string // flv / ts(fmp4) / hls
	Protocol string
	QN       int64
}

// streamPlayInfo 是 getRoomPlayInfo 的解析结果。
type streamPlayInfo struct {
	AcceptQN    []int64
	QNDesc      map[int64]string
	CurrentQN   int64
	PlayURLs    []playURL
	LiveStatus  int64
}

// fetchPlayInfo 请求一次 getRoomPlayInfo 并解析。
//
// qn 为 0 表示不指定（由上游给默认档位）。
func (c *Client) fetchPlayInfo(roomID string, qn int64) (*streamPlayInfo, error) {
	params := "room_id=" + queryEscape(roomID) +
		"&protocol=0,1" +
		"&format=0,1,2" +
		"&codec=0" +
		"&platform=html5" +
		"&dolby=5" +
		"&panorama=1"
	if qn > 0 {
		params += "&qn=" + strconv.FormatInt(qn, 10)
	}

	body, err := c.getRaw(buildURL(urlRoomPlayInfo, params))
	if err != nil {
		return nil, describe("getRoomPlayInfo 请求失败", err)
	}

	var resp struct {
		Code int64  `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			RoomID     any `json:"room_id"`
			LiveStatus any `json:"live_status"`
			PlayurlInfo struct {
				Playurl struct {
					CurrentQN any `json:"current_qn"`
					GQNDesc   []struct {
						QN   any    `json:"qn"`
						Desc string `json:"desc"`
					} `json:"g_qn_desc"`
					Stream []struct {
						ProtocolName string `json:"protocol_name"`
						Format       []struct {
							FormatName string `json:"format_name"`
							Codec      []struct {
								CodecName string  `json:"codec_name"`
								CurrentQN any     `json:"current_qn"`
								AcceptQN  []any   `json:"accept_qn"`
								BaseURL   string  `json:"base_url"`
								URLInfo   []struct {
									Host  string `json:"host"`
									Extra string `json:"extra"`
								} `json:"url_info"`
							} `json:"codec"`
						} `json:"format"`
					} `json:"stream"`
				} `json:"playurl"`
			} `json:"playurl_info"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return nil, describe("getRoomPlayInfo 解析失败", err)
	}
	if resp.Code != 0 {
		return nil, &apiError{Code: resp.Code, Message: resp.Msg, Endpoint: "getRoomPlayInfo"}
	}

	playurl := resp.Data.PlayurlInfo.Playurl
	out := &streamPlayInfo{
		QNDesc:     map[int64]string{},
		CurrentQN:  jsonInt(playurl.CurrentQN),
		LiveStatus: jsonInt(resp.Data.LiveStatus),
	}

	for _, item := range playurl.GQNDesc {
		out.QNDesc[jsonInt(item.QN)] = item.Desc
	}

	seenAccept := map[int64]bool{}
	for _, stream := range playurl.Stream {
		for _, format := range stream.Format {
			for _, codec := range format.Codec {
				for _, raw := range codec.AcceptQN {
					qnValue := jsonInt(raw)
					if qnValue > 0 && !seenAccept[qnValue] {
						seenAccept[qnValue] = true
						out.AcceptQN = append(out.AcceptQN, qnValue)
					}
				}

				for _, u := range codec.URLInfo {
					full := joinURL(u.Host, codec.BaseURL, u.Extra)
					if full == "" {
						continue
					}
					out.PlayURLs = append(out.PlayURLs, playURL{
						URL:      full,
						Format:   format.FormatName,
						Protocol: stream.ProtocolName,
						QN:       jsonInt(codec.CurrentQN),
					})
				}
			}
		}
	}

	sort.Slice(out.AcceptQN, func(i, j int) bool { return out.AcceptQN[i] > out.AcceptQN[j] })
	return out, nil
}

// joinURL 拼 host+base_url+extra。
func joinURL(host, base, extra string) string {
	if host == "" || base == "" {
		return ""
	}
	full := strings.TrimSuffix(host, "/") + base
	if extra != "" {
		if !strings.HasPrefix(extra, "?") && !strings.Contains(base, "?") {
			full += "?"
		} else if strings.HasPrefix(extra, "?") && strings.Contains(base, "?") {
			extra = strings.TrimPrefix(extra, "?")
			full += "&"
		}
		full += extra
	}
	return enforceHTTPS(full)
}

// pickPlayable 从一组地址里选一个"最可能能直接播"的。
//
// 优先 HLS（实测无 Referer 也能拉），其次才是 FLV/其它。
func pickPlayable(urls []playURL) (playURL, bool) {
	if len(urls) == 0 {
		return playURL{}, false
	}

	best := playURL{}
	bestScore := -1
	for _, u := range urls {
		score := 0
		if isHLS(u) {
			score += 100
		}
		// d1--cn 系节点在实测里最稳，给的优先级最高
		if strings.Contains(u.URL, "d1--cn") {
			score += 20
		}
		if strings.Contains(u.URL, "mcdn") {
			score -= 5
		}
		if score > bestScore {
			best, bestScore = u, score
		}
	}
	if bestScore < 0 {
		return playURL{}, false
	}
	return best, true
}

// isHLS 判断地址是不是 m3u8。
func isHLS(u playURL) bool {
	name := strings.ToLower(u.Format)
	if name == "hls" || strings.Contains(name, "ts") {
		return true
	}
	return strings.Contains(u.URL, ".m3u8")
}

// qualityLabelToQN 把前端档位（中文标签或 variant.id）映射成 qn。
//
// 注意档位与 qn 的对应关系是"一个标签对一个 qn"，不能合并：
// 原画=10000、蓝光=400、超清=250、高清=150、标清(流畅)=80。
// available 必须按 qn **降序**排列。
func qualityLabelToQN(quality string, available []int64) (int64, bool) {
	if len(available) == 0 {
		return 0, false
	}

	text := strings.TrimSpace(quality)
	if text == "" {
		return available[0], true
	}

	// 前端存的 variant.id 或直接给数字
	if n, err := strconv.ParseInt(text, 10, 64); err == nil {
		if nearest, ok := nearestAtOrBelow(available, n); ok {
			return nearest, true
		}
		return available[0], true
	}

	// 标签 → 期望 qn
	var target int64
	switch strings.ToLower(text) {
	case "原画", "蓝光原画", "source", "origin":
		target = qnOrigin
	case "蓝光", "bluray":
		target = qnBluray
	case "超清", "high":
		target = qnUltra
	case "高清", "standard":
		target = qnHigh
	case "标清", "流畅", "low", "smooth":
		target = qnSmooth
	case "4k", "2k", "杜比", "dolby":
		target = qnOrigin // 高端档位统一按原画处理
	default:
		return available[0], true
	}

	if nearest, ok := nearestAtOrBelow(available, target); ok {
		return nearest, true
	}
	// 请求的档位比所有可用档位都低 → 取最低档
	return available[len(available)-1], true
}

// nearestAtOrBelow 在降序表里找"不超过 target 的最大值"。
//
// 这样"要蓝光但只有原画"会退化成原画，"要蓝光但有超清"会退化成超清，
// 而不是像旧实现那样直接跳到最高档。
func nearestAtOrBelow(available []int64, target int64) (int64, bool) {
	for _, qn := range available {
		if qn <= target {
			return qn, true
		}
	}
	return 0, false
}

// qnSlug 给档位一个稳定的 id（与其它平台的 slug 风格一致，便于前端记忆）。
func qnSlug(qn int64) string {
	switch qn {
	case qnOrigin, qn4K, qn2K, qnDolby:
		return "source"
	case qnBluray:
		return "bluray"
	case qnUltra:
		return "high"
	case qnHigh:
		return "standard"
	case qnSmooth:
		return "low"
	default:
		return "qn" + strconv.FormatInt(qn, 10)
	}
}

// resolveVariant 为某个 qn 拉一次 playinfo 并挑出可播地址。
func (c *Client) resolveVariant(roomID string, qn int64) (string, bool) {
	info, err := c.fetchPlayInfo(roomID, qn)
	if err != nil {
		debugLog("取流 qn=%d 失败: %v", qn, err)
		return "", false
	}

	// 只保留当前 qn 的地址（上游一次只给一个档位）
	current := make([]playURL, 0, len(info.PlayURLs))
	for _, u := range info.PlayURLs {
		if u.QN == qn || u.QN == 0 || info.CurrentQN == qn {
			current = append(current, u)
		}
	}
	if len(current) == 0 {
		current = info.PlayURLs
	}

	best, ok := pickPlayable(current)
	if !ok {
		return "", false
	}
	return best.URL, true
}

// StreamInfo 返回播放页需要的房间详情 + 全部可播档位。
func (c *Client) StreamInfo(roomID, line string) (*common.StreamInfo, error) {
	normalized := NormalizeRoomID(roomID)
	if normalized == "" {
		return nil, fmt.Errorf("房间号为空")
	}

	realID, liveStatus, title, uname, err := c.roomInit(normalized)
	if err != nil {
		return nil, err
	}

	info := &common.StreamInfo{
		RoomID:   normalized,
		Platform: string(common.PlatformBilibili),
		Title:    title,
		Nickname: uname,
		IsLive:   bilibiliLiveStatus(liveStatus),
		Variants: []common.StreamVariant{},
		Lines:    []common.LineOption{{ID: "auto", Label: "自动"}},
	}
	_ = line

	// 补全房间详情（标题/头像可能更准）
	if roomData, err := c.fetchRoomInfo(realID); err == nil && roomData != nil {
		if roomData.Title != "" {
			info.Title = roomData.Title
		}
		if roomData.Nickname != "" {
			info.Nickname = roomData.Nickname
		}
		info.Avatar = roomData.Avatar
		info.IsLive = bilibiliLiveStatus(roomData.LiveStatus)
	}

	if !info.IsLive {
		return info, nil
	}

	// 先探一次拿可用档位（qn 降序）
	probe, err := c.fetchPlayInfo(realID, 0)
	if err != nil {
		return nil, err
	}
	available := probe.AcceptQN
	if len(available) == 0 {
		// 上游没给 accept_qn 时退化成 qn_desc 里出现的档位
		for qn := range probe.QNDesc {
			available = append(available, qn)
		}
		sort.Slice(available, func(i, j int) bool { return available[i] > available[j] })
	}

	if len(available) == 0 {
		return info, nil
	}

	// 只暴露 5 档（高端档位并到原画）
	var targets []int64
	for _, qn := range preferredQNOrder {
		for _, a := range available {
			if a == qn {
				targets = append(targets, qn)
				break
			}
		}
	}
	if len(targets) == 0 {
		if len(available) > 5 {
			targets = available[:5]
		} else {
			targets = available
		}
	}

	urls := make([]string, len(targets))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxVariantFetch)
	for i, qn := range targets {
		wg.Add(1)
		go func(idx int, q int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if u, ok := c.resolveVariant(realID, q); ok {
				urls[idx] = u
			}
		}(i, qn)
	}
	wg.Wait()

	for i, qn := range targets {
		if urls[i] == "" {
			continue
		}
		label := probe.QNDesc[qn]
		if label == "" {
			label = "qn" + strconv.FormatInt(qn, 10)
		}
		info.Variants = append(info.Variants, common.StreamVariant{
			ID:     qnSlug(qn),
			Label:  label,
			URL:    urls[i],
			Format: variantFormat(urls[i]),
		})
	}

	if len(info.Variants) == 0 {
		info.IsLive = false
	}
	return info, nil
}

// variantFormat 推断播放器该用哪种解码器。
func variantFormat(url string) string {
	if strings.Contains(url, ".m3u8") {
		return "hls"
	}
	return "flv"
}

// StreamURL 只返回指定档位的地址（前端兜底用）。
func (c *Client) StreamURL(roomID, quality, line string) (string, error) {
	normalized := NormalizeRoomID(roomID)
	if normalized == "" {
		return "", fmt.Errorf("房间号为空")
	}

	realID, _, _, _, err := c.roomInit(normalized)
	if err != nil {
		return "", err
	}
	_ = line

	probe, err := c.fetchPlayInfo(realID, 0)
	if err != nil {
		return "", err
	}

	qn, ok := qualityLabelToQN(quality, probe.AcceptQN)
	if !ok {
		return "", fmt.Errorf("房间 %s 没有可用清晰度", normalized)
	}

	url, ok := c.resolveVariant(realID, qn)
	if !ok {
		return "", fmt.Errorf("取流失败：房间 %s 的 qn=%d 没有可用地址", normalized, qn)
	}
	return url, nil
}
