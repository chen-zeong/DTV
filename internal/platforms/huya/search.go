package huya

import (
	"encoding/json"
	"strconv"

	"dtv/internal/platforms/common"
)

// searchResponse 是 search.cdn.huya.com 的响应。
//
// 坑：response 是一个"结果集 id → 结果"的 map，键包括 1、3、122、1024…
// 其中主播搜索用 "1"（docs 数组），而其它键（1024/1026/…) 的值是**数组**。
// 所以这里必须用 RawMessage 逐个容错解析，不能直接声明成 map[string]struct。
type searchResponse struct {
	Response map[string]json.RawMessage `json:"response"`
}

// searchDocSet 单个结果集（仅主播结果集有 docs）。
type searchDocSet struct {
	NumFound int              `json:"numFound"`
	Start    int              `json:"start"`
	Docs     []map[string]any `json:"docs"`
}

// SearchAnchor 按关键词搜索主播。
//
// 对应旧 search.rs 的 search_huya_anchors。旧实现返回 HuyaAnchorItem
// （room_id/avatar/user_name/live_status/title），这里映射成四平台统一的 SearchHit。
func (c *Client) SearchAnchor(keyword string, page, pageSize int) ([]common.SearchHit, error) {
	if keyword == "" {
		return []common.SearchHit{}, nil
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = searchPageSize
	}

	params := map[string]string{
		"m":         "Search",
		"do":        "getSearchContent",
		"q":         keyword,
		"uid":       "0",
		"v":         "1",
		"typ":       "-5", // -5 = 只看主播
		"livestate": "0",
		"rows":      strconv.Itoa(pageSize),
		"start":     strconv.Itoa((page - 1) * pageSize),
	}

	target := common.BuildQuery(urlSearch, params)
	headers := map[string]string{
		"User-Agent":      desktopUA,
		"Referer":         "https://www.huya.com/search/",
		"Origin":          "https://www.huya.com",
		"Accept":          "*/*",
		"Accept-Language": common.AcceptLanguage,
	}

	var payload searchResponse
	if err := c.http.GetJSON(target, headers, &payload); err != nil {
		return nil, err
	}

	// 旧实现只读 response["1"]（主播结果集）。这里优先用它；
	// 万一上游换了键名导致 "1" 不存在，再回退到"扫描所有结果集"。
	hits := make([]common.SearchHit, 0, searchPageSize)
	sets := []json.RawMessage{}
	if raw, ok := payload.Response["1"]; ok {
		sets = append(sets, raw)
	} else {
		for _, rawSet := range payload.Response {
			sets = append(sets, rawSet)
		}
	}

	seen := make(map[string]struct{}, searchPageSize)
	for _, rawSet := range sets {
		var set searchDocSet
		// 非主播结果集（数组形式）解析会失败，跳过即可
		if err := json.Unmarshal(rawSet, &set); err != nil {
			continue
		}
		for _, raw := range set.Docs {
			hit, ok := mapSearchDoc(raw)
			if !ok {
				continue
			}
			// 同一主播可能在多个结果集出现，按房间号去重
			if _, dup := seen[hit.ID]; dup {
				continue
			}
			seen[hit.ID] = struct{}{}
			hits = append(hits, hit)
		}
	}

	if len(hits) == 0 {
		return []common.SearchHit{}, nil
	}
	return hits, nil
}

// mapSearchDoc 把搜索结果一条映射成 SearchHit。
//
// 字段来源（实测）：
//
//	room_id            房间号（数字）
//	game_nick          主播昵称
//	live_intro         直播标题
//	game_avatarUrl180  头像
//	gameLiveOn         是否在播
func mapSearchDoc(raw map[string]any) (common.SearchHit, bool) {
	roomID := jsonString(raw["room_id"])
	if roomID == "" {
		return common.SearchHit{}, false
	}

	nickname := jsonString(raw["game_nick"])
	if nickname == "" {
		nickname = "房间 " + roomID
	}

	return common.SearchHit{
		ID:       roomID,
		Nickname: nickname,
		Title:    jsonString(raw["live_intro"]),
		Avatar:   jsonString(raw["game_avatarUrl180"]),
		IsLive:   jsonBool(raw["gameLiveOn"]),
	}, true
}
