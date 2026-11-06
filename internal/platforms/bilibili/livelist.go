package bilibili

import (
	"fmt"
	"strconv"
	"strings"

	"dtv/internal/platforms/common"
)

// areaPages 记录"上游一页给多少条"。实测固定 40 条/页，不随参数变化，
// 因此 limit 只用于前端显示，不传给上游。
const areaPages = 40

// FetchLiveList 拉某个分区的主播列表。
//
// page 从 1 开始；hasMore 由上游 data.has_more 决定（1=还有下一页）。
func (c *Client) FetchLiveList(areaID string, page, limit int) (common.StreamerPage, error) {
	parentID, childID, err := splitAreaID(areaID)
	if err != nil {
		return common.StreamerPage{}, err
	}
	if parentID == "" {
		parentID = lookupParentArea(childID)
		if parentID == "" {
			return common.StreamerPage{}, fmt.Errorf("分区 %q 缺少父分区 id，请传 “父_子” 形式（例如 2_86）", areaID)
		}
	}
	if page < 1 {
		page = 1
	}

	wWebID, err := c.wWebIDValue()
	if err != nil {
		return common.StreamerPage{}, err
	}

	// 参数顺序必须与旧实现完全一致：签名是把这些 "k=v" 按顺序拼串后加 secret 取 md5。
	params := [][2]string{
		{"area_id", childID},
		{"page", strconv.Itoa(page)},
		{"parent_area_id", parentID},
		{"platform", "web"},
		{"sort_type", ""},
		{"vajra_business_key", ""},
		{"w_webid", wWebID},
		{"web_location", "444.253"},
	}

	query, wRid := listSignQuery(params, nowSeconds())
	target := buildURL(urlLiveList, query+"&w_rid="+wRid)

	body, err := c.getRaw(target)
	if err != nil {
		return common.StreamerPage{}, describe("拉取直播列表失败", err)
	}

	var resp struct {
		Code    int64  `json:"code"`
		Message string `json:"message"`
		Data    struct {
			List    []map[string]any `json:"list"`
			HasMore any              `json:"has_more"`
			Count   any              `json:"count"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return common.StreamerPage{}, describe("解析直播列表失败", err)
	}
	if resp.Code != 0 {
		// -352 是人机校验拦截，提示更具体一些
		if resp.Code == -352 {
			return common.StreamerPage{}, fmt.Errorf("B 站人机校验拦截（-352）：w_webid 可能已失效，请稍后重试")
		}
		return common.StreamerPage{}, &apiError{Code: resp.Code, Message: resp.Message, Endpoint: "second/getList"}
	}

	items := make([]common.Streamer, 0, len(resp.Data.List))
	for _, raw := range resp.Data.List {
		if s, ok := mapLiveListItem(raw); ok {
			items = append(items, s)
		}
	}

	hasMore := jsonBool(resp.Data.HasMore)
	// 上游没给 has_more 时，按"本页是否满页"兜底推断
	if resp.Data.HasMore == nil && len(items) >= areaPages {
		hasMore = true
	}

	result := common.StreamerPage{
		Items:   items,
		Page:    page,
		HasMore: hasMore,
	}
	// 总页数上游不返回，留空由前端按 hasMore 判断
	_ = limit
	return result, nil
}

// mapLiveListItem 把上游一条房间转成 Streamer。
func mapLiveListItem(raw map[string]any) (common.Streamer, bool) {
	roomID := jsonString(raw["roomid"])
	if roomID == "" || roomID == "0" {
		return common.Streamer{}, false
	}

	title := jsonString(raw["title"])
	if title == "" {
		title = jsonString(raw["area_name"])
	}

	return common.Streamer{
		ID:           roomID,
		Platform:     string(common.PlatformBilibili),
		Nickname:     jsonString(raw["uname"]),
		Title:        strings.TrimSpace(stripEMTags(title)),
		Cover:        httpsURL(firstNonEmpty(jsonString(raw["cover"]), jsonString(raw["user_cover"]), jsonString(raw["system_cover"]))),
		Avatar:       httpsURL(jsonString(raw["face"])),
		Viewers:      jsonInt(raw["online"]),
		CategoryName: firstNonEmpty(jsonString(raw["area_name"]), jsonString(raw["area_v2_name"]), jsonString(raw["parent_name"])),
		IsLive:       true, // 该接口只返回在播房间
	}, true
}

// lookupParentArea 按子分区 id 反查父分区 id（分区表有缓存，代价很小）。
//
// 前端若只传子分区 id（旧数据形如 "86"），这里仍能救回来。
func lookupParentArea(childID string) string {
	groups, err := FetchCategories()
	if err != nil {
		return ""
	}
	for _, g := range groups {
		for _, c := range g.Categories {
			parent, child, err := splitAreaID(c.ID)
			if err == nil && child == childID {
				return parent
			}
		}
	}
	return ""
}