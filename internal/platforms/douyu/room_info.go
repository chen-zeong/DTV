package douyu

import (
	"fmt"

	"dtv/internal/platforms/common"
)

// RoomDetail 是 betard 接口归一化后的房间信息。
type RoomDetail struct {
	// RealRoomID 是斗鱼返回的真实房间号（短号会被解析成短号自身的 id）。
	RealRoomID string
	Title      string
	Nickname   string
	Avatar     string
	Cover      string
	Category   string
	IsLive     bool
	VideoLoop  bool
}

// FetchRoomDetail 拉房间详情（betard）。
//
// 旧实现 (fetch_douyu_room_info.rs) 对响应结构做了 4 种路径兜底，因为不同房间
// 返回的包装层不一样：{data:{room}} / {data} / {room} / 根对象。这里保持一致。
func (c *Client) FetchRoomDetail(roomID string) (*RoomDetail, error) {
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}

	var payload map[string]any
	headers := map[string]string{
		"User-Agent": desktopUA,
		"Referer":    refererFor(roomID),
	}
	if err := c.http.GetJSON(fmt.Sprintf(urlBetard, roomID), headers, &payload); err != nil {
		return nil, err
	}

	room := locateRoomObject(payload)
	if room == nil {
		return nil, fmt.Errorf("房间 %s 未返回房间数据（可能房间不存在）", roomID)
	}

	detail := &RoomDetail{
		RealRoomID: jsonString(room["room_id"]),
		Title:      jsonString(room["room_name"]),
		Nickname:   jsonString(room["nickname"]),
		Avatar:     firstNonEmpty(jsonString(room["avatar_mid"]), nestedString(room, "avatar", "middle")),
		Cover:      fullURL(coverPrefix, jsonString(room["room_src"])),
		Category:   firstNonEmpty(jsonString(room["second_lvl_name"]), jsonString(room["cate2_name"])),
	}
	if detail.RealRoomID == "" {
		detail.RealRoomID = roomID
	}
	if detail.Nickname == "" {
		detail.Nickname = firstNonEmpty(jsonString(room["owner_name"]), "房间 "+roomID)
	}

	showStatus := jsonInt64(room["show_status"])
	videoLoop := jsonInt64(room["videoLoop"])
	isLoop := jsonInt64(room["isLoop"])
	detail.IsLive = isLiveFromFlags(showStatus, isLoop, videoLoop)
	detail.VideoLoop = videoLoop == 1 || isLoop == 1

	return detail, nil
}

// FetchRoomInfo 是给"关注列表刷新"用的轻量接口，语义对齐旧项目的
// fetch_douyu_room_info（只取卡片需要的字段）。
func (c *Client) FetchRoomInfo(roomID string) (*common.Streamer, error) {
	detail, err := c.FetchRoomDetail(roomID)
	if err != nil {
		return nil, err
	}
	return &common.Streamer{
		ID:           detail.RealRoomID,
		Platform:     string(common.PlatformDouyu),
		Nickname:     detail.Nickname,
		Title:        detail.Title,
		Cover:        detail.Cover,
		Avatar:       detail.Avatar,
		CategoryName: detail.Category,
		IsLive:       detail.IsLive,
	}, nil
}

// locateRoomObject 在多种响应包装里找到"房间对象"。
func locateRoomObject(payload map[string]any) map[string]any {
	// 1) { data: { room: {...} } }
	if data, ok := payload["data"].(map[string]any); ok {
		// 2) { data: { ...room... } }
		if room, ok := data["room"].(map[string]any); ok {
			return room
		}
		return data
	}
	// 3) { room: {...} }
	if room, ok := payload["room"].(map[string]any); ok {
		return room
	}
	// 4) 根对象就是房间
	return payload
}

// nestedString 取嵌套字段的字符串值。
func nestedString(obj map[string]any, path ...string) string {
	current := obj
	for i, key := range path {
		next, ok := current[key].(map[string]any)
		if !ok {
			if i == len(path)-1 {
				return jsonString(current[key])
			}
			return ""
		}
		current = next
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
