package douyu

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"dtv/internal/platforms/common"
)

// searchUserResponse 对应 www.douyu.com/japi/search/api/searchUser。
//
// 真实响应：
//
//	{ data: { pageSize, total, relateUser: [ { anchorInfo: {..., type: 1} } ] } }
//
// 旧 Rust 实现只把整段文本透传给前端，由 web/src/services/search.ts 解析。
// 这里把同一套解析规则下沉到 Go，直接返回前端要的 SearchHit。
type searchUserResponse struct {
	Data struct {
		RelateUser []struct {
			Type       any            `json:"type"`
			AnchorInfo map[string]any `json:"anchorInfo"`
		} `json:"relateUser"`
		// 个别版本叫 relateUserList / relate
		RelateUserList []struct {
			Type       any            `json:"type"`
			AnchorInfo map[string]any `json:"anchorInfo"`
		} `json:"relateUserList"`
	} `json:"data"`
}

// SearchAnchor 按关键词搜索主播。
//
// 与旧实现一致：带一个临时 did cookie（斗鱼会按 did 做简单限流，缺 cookie 时
// 更容易触发验证码）。
func (c *Client) SearchAnchor(keyword string, page, pageSize int) ([]common.SearchHit, error) {
	trimmed := keyword
	for len(trimmed) > 0 && (trimmed[0] == ' ' || trimmed[0] == '\t' || trimmed[0] == '\n') {
		trimmed = trimmed[1:]
	}
	if trimmed == "" {
		return []common.SearchHit{}, nil
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	did := c.makeDID()
	target := fmt.Sprintf("%s?kw=%s&page=%d&pageSize=%d&filterType=0",
		urlSearchUser, url.QueryEscape(trimmed), page, pageSize)

	var payload searchUserResponse
	headers := map[string]string{
		"User-Agent": desktopUA,
		"Referer":    "https://www.douyu.com/search/",
		"Cookie":     "dy_did=" + did + "; acf_did=" + did,
	}
	if err := c.http.GetJSON(target, headers, &payload); err != nil {
		return nil, err
	}

	items := payload.Data.RelateUser
	if len(items) == 0 {
		items = payload.Data.RelateUserList
	}

	out := make([]common.SearchHit, 0, len(items))
	for _, item := range items {
		// type===1 才是主播用户（其余是分类/视频等混合结果）
		if item.Type != nil && jsonInt64(item.Type) != 1 {
			continue
		}

		info := item.AnchorInfo
		if info == nil {
			continue
		}

		roomID := jsonString(info["rid"])
		if roomID == "" {
			// 兜底：bkUrl 形如 https://www.douyu.com/606118
			if bkURL := jsonString(info["bkUrl"]); bkURL != "" {
				roomID = lastPathSegment(bkURL)
			}
		}
		nickname := firstNonEmpty(jsonString(info["nickName"]), jsonString(info["nickname"]))
		if roomID == "" || nickname == "" {
			continue
		}

		title := firstNonEmpty(
			jsonString(info["roomName"]),
			jsonString(info["description"]),
			"暂无标题",
		)

		out = append(out, common.SearchHit{
			ID:       roomID,
			Nickname: nickname,
			Title:    title,
			Avatar:   douyuAvatarURL(jsonString(info["avatar"])),
			IsLive: isLiveFromFlags(
				// 搜索结果里 isLive 语义是 2=直播中（不是 1），保持旧前端规则。
				normalizeSearchLive(jsonInt64(info["isLive"])),
				jsonInt64(info["isLoop"]),
				jsonInt64(info["videoLoop"]),
			),
		})
	}

	return out, nil
}

// normalizeSearchLive 把搜索接口的 isLive(2=直播中) 归一成 show_status 语义(1=直播中)。
func normalizeSearchLive(raw int64) int64 {
	if raw == 2 {
		return 1
	}
	if raw == 1 {
		// 旧规则要求 2 才算直播；1 视为非直播。
		return 0
	}
	return 0
}

// makeDID 生成一个临时 did（纳秒时间戳的 MD5），与旧实现一致。
func (c *Client) makeDID() string {
	sum := md5.Sum([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
	return hex.EncodeToString(sum[:])
}

func lastPathSegment(rawURL string) string {
	trimmed := rawURL
	for len(trimmed) > 0 && trimmed[len(trimmed)-1] == '/' {
		trimmed = trimmed[:len(trimmed)-1]
	}
	for i := len(trimmed) - 1; i >= 0; i-- {
		if trimmed[i] == '/' {
			return trimmed[i+1:]
		}
	}
	return trimmed
}
