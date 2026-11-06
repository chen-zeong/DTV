package douyu

import (
	"fmt"

	"dtv/internal/platforms/common"
)

// directoryResponse 是 web 目录接口的统一响应（2_x 与 mixListV1/3_x 结构相同）。
//
//	data.rl 是房间数组；每个房间字段：
//	  rid  房间号（数字）
//	  rn   房间标题
//	  nn   主播昵称
//	  av   主播头像（2_x 里是相对路径，3_x 里是完整 URL）
//	  rs16 封面 URL（.avif，斗鱼按 /dyN 后缀分发尺寸）
//	  ol   在线人气
//	  cid2 二级分区 id
//	  c2name 二级分区名
type directoryResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Pgcnt int              `json:"pgcnt"`
		Rl    []map[string]any `json:"rl"`
	} `json:"data"`
}

// FetchLiveList 按二级分区拉直播列表（cate2）的第 page 页。
//
// 对应旧项目 fetch_live_list。旧实现打的是 m.douyu.com/hgapi/live/cate/newRecList，
// 该接口目前固定返回 {"error":1,"msg":"系统异常，请重试"}（实测 2026-10），
// 因此改用斗鱼 web 站正在使用的 gapi/rkc/directory/2_{cate2}/{page}，
// 字段（rid/rn/nn/av/rs16/ol）与旧结构一一对应。
//
// 返回 StreamerPage：接口自带 data.pgcnt（总页数），用它判断 hasMore，
// 前端因此可以做无限滚动而不是只显示第一页。
func (c *Client) FetchLiveList(cate2ID string, page, limit int) (common.StreamerPage, error) {
	cate2ID = c.resolveCate2ID(cate2ID)
	if cate2ID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少二级分区 id")
	}
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = defaultPageSize
	}

	target := fmt.Sprintf(urlDirectory, "2_"+cate2ID, page, limit)
	return c.fetchDirectory(target, page, limit)
}

// FetchLiveListForCate3 按三级分区拉直播列表（cate3）的第 page 页。
//
// 对应旧项目 fetch_live_list_for_cate3；接口与字段和 cate2 版本一致，
// 只是路径段换成 mixListV1/3_{cate3}。
func (c *Client) FetchLiveListForCate3(cate3ID string, page, limit int) (common.StreamerPage, error) {
	if cate3ID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少三级分区 id")
	}
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = defaultPageSize
	}

	target := fmt.Sprintf(urlMixList, cate3ID, page, limit)
	return c.fetchDirectory(target, page, limit)
}

// fetchDirectory 是两个列表接口的公共实现。
func (c *Client) fetchDirectory(target string, page, limit int) (common.StreamerPage, error) {
	var payload directoryResponse
	headers := map[string]string{
		"User-Agent": desktopUA,
		"Referer":    "https://www.douyu.com/",
	}
	if err := c.http.GetJSON(target, headers, &payload); err != nil {
		return common.StreamerPage{}, err
	}
	if payload.Code != 0 {
		return common.StreamerPage{}, fmt.Errorf("斗鱼列表接口返回错误 code=%d msg=%s", payload.Code, payload.Msg)
	}

	rooms := make([]common.Streamer, 0, len(payload.Data.Rl))
	for _, raw := range payload.Data.Rl {
		streamer, ok := mapDirectoryItem(raw)
		if ok {
			rooms = append(rooms, streamer)
		}
	}

	// 接口忽略 limit 参数、一次返回最多 120 条，这里按请求页大小截断，
	// 让"一页"对前端来说是可预期的。
	if len(rooms) > limit {
		rooms = rooms[:limit]
	}

	// 不要用 len(rooms)==0 报错：分页的最后一页本来就是空的，
	// 报错会让前端把"到底了"显示成"加载失败"。空列表交给前端渲染空状态。
	return common.StreamerPage{
		Items:      rooms,
		Page:       page,
		HasMore:    payload.Data.Pgcnt > page,
		TotalPages: payload.Data.Pgcnt,
	}, nil
}

// mapDirectoryItem 把目录接口里的一条房间数据映射成前端 Streamer。
func mapDirectoryItem(raw map[string]any) (common.Streamer, bool) {
	roomID := jsonString(raw["rid"])
	if roomID == "" {
		return common.Streamer{}, false
	}

	streamer := common.Streamer{
		ID:       roomID,
		Platform: string(common.PlatformDouyu),
		Nickname: jsonString(raw["nn"]),
		Title:    jsonString(raw["rn"]),
		Cover:    fullURL(coverPrefix, jsonString(raw["rs16"])),
		Avatar:   douyuAvatarURL(jsonString(raw["av"])),
		Viewers:  int64(jsonFloat(raw["ol"])),
		// 目录接口直接带二级分区名，省掉一次分区查询。
		CategoryName: jsonString(raw["c2name"]),
		IsLive:       true,
	}

	// 3_x（三级分区）响应带 type 字段：1 表示直播中，0 表示录播/离线。
	if t, ok := raw["type"]; ok && t != nil {
		streamer.IsLive = jsonInt64(t) == 1
	}

	// rs16 缺失时退回 rs1（同一张图，不同 CDN 后缀）
	if streamer.Cover == "" {
		streamer.Cover = fullURL(coverPrefix, jsonString(raw["rs1"]))
	}
	// 昵称为空时用房号兜底，避免卡片出现空白标题
	if streamer.Nickname == "" {
		streamer.Nickname = "房间 " + roomID
	}
	return streamer, true
}
