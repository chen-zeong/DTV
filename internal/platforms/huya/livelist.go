package huya

import (
	"fmt"
	"strings"

	"dtv/internal/platforms/common"
)

// liveListResponse 是 getLiveList 的响应。
//
// 字段与实测一致（2026-10）：
//
//	iPageNo / iPageSize / iTotal / iTotalPage  分页信息（iTotal 可达百万级，用 float 解析）
//	vList                                     房间数组
//
// 每个房间用到的字段：
//
//	lProfileRoom  房间号
//	sNick         主播昵称
//	sIntroduction 房间标题（旧实现也用它当 title）
//	sScreenshot   房间封面
//	sAvatar180    头像
//	lUserCount    人气值（浮点，可能是科学计数法）
//	sGameFullName / sGameHostName 分区名
type liveListResponse struct {
	PageNo    int64            `json:"iPageNo"`
	PageSize  int64            `json:"iPageSize"`
	Total     float64          `json:"iTotal"`
	TotalPage float64          `json:"iTotalPage"`
	VList     []map[string]any `json:"vList"`
}

// FetchLiveList 按分区（iGid）拉第 page 页直播列表。
//
// 对应旧实现在 live_list.rs 的 fetch_huya_live_list。
// 改进：旧实现只把 vList 透传、丢掉 iTotalPage，前端无法判断"还有没有下一页"；
// 这里把 hasMore 明确算出来，供列表无限滚动使用。
func (c *Client) FetchLiveList(gid string, page, limit int) (common.StreamerPage, error) {
	// 老版订阅存的是网页地址（https://www.huya.com/g/lol），新版接口只要 gid。
	gid = normalizeGID(gid)
	if gid == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少虎牙分区 id")
	}
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = defaultPageSize
	}

	target := fmt.Sprintf(urlLiveList, gid, page, limit)
	headers := map[string]string{
		"User-Agent": desktopUA,
		"Referer":    referer,
		"Accept":     "*/*",
	}

	var payload liveListResponse
	if err := c.http.GetJSON(target, headers, &payload); err != nil {
		return common.StreamerPage{}, err
	}

	rooms := make([]common.Streamer, 0, len(payload.VList))
	for _, raw := range payload.VList {
		streamer, ok := mapLiveListItem(raw)
		if ok {
			rooms = append(rooms, streamer)
		}
	}

	totalPages := int(payload.TotalPage)
	// iTotalPage 缺失时（极少数分区）退化成"本页满员就还有下一页"
	hasMore := payload.PageNo < int64(totalPages)
	if totalPages == 0 {
		hasMore = len(rooms) >= effectivePageSize(payload.PageSize, limit)
	}

	// 注意：虎牙会忽略请求里的 iPageSize，固定按 120 条/页返回
	// （iTotalPage=4 → 约 480 个房间）。这里**不做截断**：
	// 截成 20 条会把同一页里剩下的 100 个房间丢掉，而这些房间
	// 在下一页也不会再出现（第 2 页是另外 120 个）。
	return common.StreamerPage{
		Items:      rooms,
		Page:       page,
		HasMore:    hasMore,
		TotalPages: totalPages,
	}, nil
}

// effectivePageSize 返回实际期望的页大小（用于 hasMore 的兜底判断）。
func effectivePageSize(reported int64, requested int) int {
	if reported > 0 {
		return int(reported)
	}
	if requested > 0 {
		return requested
	}
	return defaultPageSize
}

// normalizeGID 兼容老版订阅里的网页地址：
// https://www.huya.com/g/lol → lol；也接受纯 gid。
func normalizeGID(raw string) string {
	text := strings.TrimSpace(raw)
	if i := strings.LastIndex(text, "/g/"); i >= 0 {
		text = text[i+3:]
	}
	if i := strings.IndexAny(text, "?#"); i >= 0 {
		text = text[:i]
	}
	text = strings.Trim(text, "/")
	text = strings.TrimPrefix(text, "g_")
	return text
}

// mapLiveListItem 把 vList 的一条映射成前端 Streamer。
func mapLiveListItem(raw map[string]any) (common.Streamer, bool) {
	roomID := jsonString(raw["lProfileRoom"])
	if roomID == "" {
		return common.Streamer{}, false
	}

	nickname := jsonString(raw["sNick"])
	if nickname == "" {
		nickname = "房间 " + roomID
	}

	return common.Streamer{
		ID:       roomID,
		Platform: string(common.PlatformHuya),
		Nickname: nickname,
		Title:    jsonString(raw["sIntroduction"]),
		Cover:    jsonString(raw["sScreenshot"]),
		Avatar:   jsonString(raw["sAvatar180"]),
		Viewers:  int64(jsonFloat(raw["lUserCount"])),
		// 列表接口直接带分区名，省一次请求
		CategoryName: firstNonEmpty(jsonString(raw["sGameFullName"]), jsonString(raw["sGameHostName"])),
		IsLive:       true,
	}, true
}
