package douyin

import (
	"encoding/json"
	"fmt"
	"strings"

	"dtv/internal/platforms/common"
)

// 抖音分区列表接口。
//
// 与旧实现一致：参数固定一堆 web 端标识，外加 partition / partition_type /
// offset / count 与一个随机 msToken。

const (
	listPageSize = 15
)

// partitionResponse 是 partition/detail/room/v2 的响应。
//
// 成功时 data 是对象（含 data 数组），失败时 data 可能是别的形状，
// 因此这里用 RawMessage 接住，再分两步解析。
type partitionResponse struct {
	StatusCode int             `json:"status_code"`
	Data       json.RawMessage `json:"data"`
}

// partitionWrapper 是成功响应里的 data。
type partitionWrapper struct {
	Data    []partitionRoom `json:"data"`
	Count   int             `json:"count"`
	Offset  int             `json:"offset"`
	HasMore bool            `json:"has_more"`
}

// partitionRoom 是一条直播间记录。
type partitionRoom struct {
	WebRID string      `json:"web_rid"`
	Room   partitionRm `json:"room"`
}

type partitionRm struct {
	IDStr string `json:"id_str"`
	Title string `json:"title"`
	Cover urlList `json:"cover"`
	Owner struct {
		Nickname    string  `json:"nickname"`
		AvatarThumb urlList `json:"avatar_thumb"`
	} `json:"owner"`
	Stats struct {
		TotalUserStr string `json:"total_user_str"`
		UserCountStr string `json:"user_count_str"`
	} `json:"stats"`
}

// urlList 是抖音统一的 {url_list:[...]} 结构。
type urlList struct {
	URLList []string `json:"url_list"`
}

// first 取第一个有效地址。
func (u urlList) first() string {
	if len(u.URLList) == 0 {
		return ""
	}
	return u.URLList[0]
}

// FetchLiveList 拉某一页分区直播。
//
// cateID 形如 "1_1010032"（partition_type_partition），由分区表给出。
// page 从 1 开始，内部换算成 offset。
func (c *Client) FetchLiveList(cateID string, page, limit int) (common.StreamerPage, error) {
	partitionType, partition, err := splitPartitionID(cateID)
	if err != nil {
		return common.StreamerPage{}, err
	}

	if page < 1 {
		page = 1
	}
	pageSize := limit
	if pageSize <= 0 || pageSize > listPageSize {
		pageSize = listPageSize
	}
	offset := (page - 1) * pageSize

	params := [][2]string{
		{"aid", paramAid},
		{"app_name", "douyin_web"},
		{"live_id", paramLiveID},
		{"device_platform", "web"},
		{"language", "zh-CN"},
		{"enter_from", "web_homepage_hot"},
		{"cookie_enabled", "true"},
		{"screen_width", "1920"},
		{"screen_height", "1080"},
		{"browser_language", "zh-CN"},
		{"browser_platform", "Win32"},
		{"browser_name", "Chrome"},
		{"browser_version", "116.0.0.0"},
		{"count", fmt.Sprint(pageSize)},
		{"offset", fmt.Sprint(offset)},
		{"partition", partition},
		{"partition_type", partitionType},
		{"req_from", "2"},
		{"msToken", GenerateMsToken(107)},
	}

	var resp partitionResponse
	if err := c.getJSON(signedURL(urlPartitionV2, params), &resp); err != nil {
		return common.StreamerPage{}, err
	}
	if resp.StatusCode != 0 {
		return common.StreamerPage{}, fmt.Errorf("抖音分区列表返回 status_code=%d", resp.StatusCode)
	}

	var wrapper partitionWrapper
	if err := json.Unmarshal(resp.Data, &wrapper); err != nil {
		return common.StreamerPage{}, fmt.Errorf("解析抖音分区数据失败: %w", err)
	}

	items := make([]common.Streamer, 0, len(wrapper.Data))
	for _, entry := range wrapper.Data {
		items = append(items, mapPartitionRoom(entry))
	}

	// 抖音不给总页数，只能靠 has_more / 本页是否满来判断
	hasMore := wrapper.HasMore || len(wrapper.Data) >= pageSize

	return common.StreamerPage{
		Items:   items,
		Page:    page,
		HasMore: hasMore,
	}, nil
}

// mapPartitionRoom 把抖音的分区记录映射成统一直播卡片。
func mapPartitionRoom(entry partitionRoom) common.Streamer {
	room := entry.Room

	viewerText := room.Stats.UserCountStr
	if viewerText == "" {
		viewerText = room.Stats.TotalUserStr
	}

	return common.Streamer{
		ID:       entry.WebRID,
		Platform: string(common.PlatformDouyin),
		Nickname: room.Owner.Nickname,
		Title:    room.Title,
		Cover:    room.Cover.first(),
		Avatar:   room.Owner.AvatarThumb.first(),
		// 抖音给的是"1.2万"这类字符串，统一换算成数字
		Viewers: parseViewerText(viewerText),
		IsLive:  true,
	}
}

// splitPartitionID 把 "1_1010032" 拆成 (partition_type, partition)。
//
// 旧前端是从 href 里按 '_' 切最后两段，这里用同样的规则。
func splitPartitionID(cateID string) (partitionType string, partition string, err error) {
	trimmed := strings.TrimSpace(cateID)
	// 允许直接传完整 href：/category/1_1_1_1010032
	if i := strings.LastIndex(trimmed, "/category/"); i >= 0 {
		trimmed = trimmed[i+len("/category/"):]
	}
	trimmed = strings.TrimPrefix(trimmed, "/")

	parts := strings.Split(trimmed, "_")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("抖音分区 id 格式应为 partition_type_partition，实际 %q", cateID)
	}
	partitionType = parts[len(parts)-2]
	partition = parts[len(parts)-1]
	if partitionType == "" || partition == "" {
		return "", "", fmt.Errorf("抖音分区 id 不完整: %q", cateID)
	}
	return partitionType, partition, nil
}
