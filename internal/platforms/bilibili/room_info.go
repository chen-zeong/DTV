package bilibili

import (
	"fmt"
	"strconv"
	"strings"

	"dtv/internal/platforms/common"
)

// room_info.go 负责"房间号 → 房间详情"。
//
// B 站房间号有两种：短号（如 6）与真实 room_id（如 7734200）。
// 短号必须先经 room_get_info 换成真实 room_id，后续所有接口（playinfo/弹幕）都只认真实 id。

// NormalizeRoomID 从各种输入里取房间号（纯短号或 room_id）。
//
// 支持：纯数字、"https://live.bilibili.com/7734200"、"live.bilibili.com/6?x=1"。
func NormalizeRoomID(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}

	// 去掉协议/域名，取最后一段
	if strings.Contains(text, "//") {
		if idx := strings.Index(text, "//"); idx >= 0 {
			text = text[idx+2:]
		}
	}
	if idx := strings.IndexAny(text, "?#"); idx >= 0 {
		text = text[:idx]
	}
	// 结尾斜杠要先去掉，否则最后一段是空串（"live.bilibili.com/6/" 会取到 ""）
	text = strings.TrimRight(text, "/")
	if idx := strings.LastIndex(text, "/"); idx >= 0 {
		text = text[idx+1:]
	}

	// 只要数字
	digits := strings.Builder{}
	for _, r := range text {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
			continue
		}
		// 遇到非数字就停（避免把 "6abc" 拼成 6 以外的值）
		if digits.Len() > 0 {
			break
		}
	}
	return digits.String()
}

// roomInit 把短号换成真实 room_id，并拿到 live_status。
//
// live_status: 0=未开播, 1=直播中, 2=轮播（B 站把轮播也当"可播"）。
//
// 不再用 /room/v1/Room/room_init：2026-11 起它对匿名请求直接返回 HTTP 412
// （带 finger/spi 下发的新 buvid3 也一样），于是关注列表刷新全部落到
// "未开播"、所有直播间的取流也在第一步就失败。get_info 仍然匿名可用，
// room_id / live_status / title 都有；主播昵称交给 getInfoByRoom 补。
func (c *Client) roomInit(roomID string) (realID string, liveStatus int64, title, uname string, err error) {
	target := buildURL(urlRoomGetInfo, "room_id="+queryEscape(roomID))
	body, err := c.getRaw(target)
	if err != nil {
		return "", 0, "", "", describe("room_get_info 请求失败", err)
	}

	var resp struct {
		Code    int64  `json:"code"`
		Msg     string `json:"msg"`
		Message string `json:"message"`
		Data    struct {
			RoomID     any    `json:"room_id"`
			ShortID    any    `json:"short_id"`
			UID        any    `json:"uid"`
			LiveStatus any    `json:"live_status"`
			Title      string `json:"title"`
			Uname      string `json:"uname"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return "", 0, "", "", describe("room_get_info 解析失败", err)
	}
	if resp.Code != 0 {
		message := firstNonEmpty(resp.Msg, resp.Message)
		return "", 0, "", "", &apiError{Code: resp.Code, Message: message, Endpoint: "Room/get_info"}
	}

	realID = jsonString(resp.Data.RoomID)
	if realID == "" {
		realID = roomID
	}
	return realID, jsonInt(resp.Data.LiveStatus), resp.Data.Title, resp.Data.Uname, nil
}

// roomInfoData 是 getInfoByRoom 里我们用到的字段。
type roomInfoData struct {
	Title      string
	Nickname   string
	Avatar     string
	Cover      string
	Viewers    int64
	AreaName   string
	LiveStatus int64
	RealID     string
}

// fetchRoomInfo 调 getInfoByRoom（WBI 签名）。
func (c *Client) fetchRoomInfo(roomID string) (*roomInfoData, error) {
	imgKey, subKey, err := c.wbiKeys()
	if err != nil {
		return nil, describe("获取 WBI 签名失败", err)
	}

	query := wbiSignedQuery([][2]string{
		{"room_id", roomID},
		{"web_location", "444.8"},
	}, imgKey, subKey, nowSeconds())

	body, err := c.getRaw(buildURL(urlRoomInfo, query))
	if err != nil {
		return nil, describe("getInfoByRoom 请求失败", err)
	}

	var resp struct {
		Code int64  `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			RoomInfo struct {
				RoomID     any    `json:"room_id"`
				ShortID    any    `json:"short_id"`
				Title      string `json:"title"`
				LiveStatus any    `json:"live_status"`
				AreaName   string `json:"area_name"`
				ParentArea string `json:"parent_area_name"`
				UserCover  string `json:"user_cover"`
				Keyframe   string `json:"keyframe"`
				Cover      string `json:"cover"`
				Online     any    `json:"online"`
				UID        any    `json:"uid"`
			} `json:"room_info"`
			AnchorInfo struct {
				BaseInfo struct {
					Uname string `json:"uname"`
					Face  string `json:"face"`
				} `json:"base_info"`
			} `json:"anchor_info"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return nil, describe("getInfoByRoom 解析失败", err)
	}
	if resp.Code != 0 {
		return nil, &apiError{Code: resp.Code, Message: resp.Msg, Endpoint: "getInfoByRoom"}
	}

	info := &resp.Data.RoomInfo
	base := &resp.Data.AnchorInfo.BaseInfo

	return &roomInfoData{
		Title:      info.Title,
		Nickname:   base.Uname,
		Avatar:     httpsURL(base.Face),
		Cover:      httpsURL(firstNonEmpty(info.UserCover, info.Keyframe, info.Cover)),
		Viewers:    jsonInt(info.Online),
		AreaName:   firstNonEmpty(info.AreaName, info.ParentArea),
		LiveStatus: jsonInt(info.LiveStatus),
		RealID:     firstNonEmpty(jsonString(info.RoomID), jsonString(info.ShortID)),
	}, nil
}

// bilibiliLiveStatus 把 B 站 live_status 归一成"是否正在直播"。
//
// 对齐旧项目（web/src/components/follows/FollowsList.tsx 的 refreshOne）：
// 只有 live_status==1 才是直播中；2 是"轮播/回放"，界面上按未开播处理，
// 否则轮播中的房间会一直挂着"直播中"，刷新也下不来。
func bilibiliLiveStatus(liveStatus int64) bool {
	return liveStatus == 1
}

// Streamer 返回主播卡片所需的房间详情。
func (c *Client) Streamer(roomID string) (common.Streamer, error) {
	normalized := NormalizeRoomID(roomID)
	if normalized == "" {
		return common.Streamer{}, fmt.Errorf("房间号为空")
	}

	realID, liveStatus, title, uname, err := c.roomInit(normalized)
	if err != nil {
		return common.Streamer{}, err
	}

	info, err := c.fetchRoomInfo(realID)
	if err != nil {
		// getInfoByRoom 失败时用 room_get_info 的字段兜底，保证卡片不至于全空
		return common.Streamer{
			ID:           normalized,
			Platform:     string(common.PlatformBilibili),
			Nickname:     uname,
			Title:        title,
			Viewers:      0,
			CategoryName: "",
			IsLive:       bilibiliLiveStatus(liveStatus),
		}, nil
	}

	return common.Streamer{
		ID:           normalized,
		Platform:     string(common.PlatformBilibili),
		Nickname:     info.Nickname,
		Title:        info.Title,
		Cover:        info.Cover,
		Avatar:       info.Avatar,
		Viewers:      info.Viewers,
		CategoryName: info.AreaName,
		IsLive:       bilibiliLiveStatus(info.LiveStatus),
	}, nil
}

// formatRoomID 便于日志输出。
func formatRoomID(roomID string) string {
	if roomID == "" {
		return "<空>"
	}
	return roomID
}

var _ = strconv.Itoa
