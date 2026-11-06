package bilibili

import (
	"fmt"
	"strings"

	"dtv/internal/platforms/common"
)

// SearchRoom 按关键词搜直播间。
//
// 用的是全站搜索接口（`search/type?search_type=live`），
// 它 **不需要 WBI 签名**，但需要 buvid3（否则容易被判无人设备直接返回空）。
// 结果里 title/uname 带 `<em class="keyword">` 高亮标签，必须清掉再展示。
func (c *Client) SearchRoom(keyword string, page, pageSize int) ([]common.SearchHit, error) {
	text := strings.TrimSpace(keyword)
	if text == "" {
		return []common.SearchHit{}, nil
	}
	if page < 1 {
		page = 1
	}

	buvid := c.buvidValue()
	cookie := "buvid3=" + buvid + ";"
	if buvid == "" {
		cookie = "buvid3=i;"
	}

	// 参数与旧实现一致（这些空值参数不是摆设：少了会掉到"无结果"分支）
	params := [][2]string{
		{"context", ""},
		{"search_type", "live"},
		{"cover_type", "user_cover"},
		{"order", ""},
		{"keyword", text},
		{"category_id", ""},
		{"__refresh__", ""},
		{"_extra", ""},
		{"highlight", "0"},
		{"single_column", "0"},
		{"page", fmt.Sprint(page)},
	}

	parts := make([]string, 0, len(params))
	for _, kv := range params {
		parts = append(parts, kv[0]+"="+queryEscape(kv[1]))
	}
	target := buildURL(urlSearchType, strings.Join(parts, "&"))

	resp, err := c.http.Get(target, map[string]string{
		"User-Agent": desktopUA,
		"Referer":    referer,
		"Origin":     origin,
		"Cookie":     cookie,
	})
	if err != nil {
		return nil, describe("搜索请求失败", err)
	}
	defer resp.Body.Close()

	body, err := readAll(resp.Body)
	if err != nil {
		return nil, describe("搜索读取失败", err)
	}

	var parsed struct {
		Code    int64  `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Result struct {
				// live_room 是真实的直播间列表（40 条，含标题/人气/封面）；
				// live_user 只是"相关主播"（6 条，没有标题和人气），
				// 旧实现用的是 live_user，所以搜出来的卡片标题总是空的。
				LiveRoom []map[string]any `json:"live_room"`
				LiveUser []map[string]any `json:"live_user"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := unmarshalJSON(body, &parsed); err != nil {
		return nil, describe("搜索解析失败", err)
	}
	if parsed.Code != 0 {
		return nil, &apiError{Code: parsed.Code, Message: parsed.Message, Endpoint: "search/type"}
	}

	raw := parsed.Data.Result.LiveRoom
	if len(raw) == 0 {
		raw = parsed.Data.Result.LiveUser
	}

	hits := make([]common.SearchHit, 0, len(raw))
	for _, item := range raw {
		roomID := jsonString(item["roomid"])
		if roomID == "" || roomID == "0" {
			continue
		}
		hits = append(hits, common.SearchHit{
			ID:       roomID,
			Nickname: strings.TrimSpace(stripEMTags(jsonString(item["uname"]))),
			Title:    strings.TrimSpace(stripEMTags(jsonString(item["title"]))),
			Avatar:   httpsURL(jsonString(item["uface"])),
			IsLive:   jsonInt(item["live_status"]) == 1,
		})
		if pageSize > 0 && len(hits) >= pageSize {
			break
		}
	}
	return hits, nil
}
