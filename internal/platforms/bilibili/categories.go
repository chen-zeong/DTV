package bilibili

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"dtv/internal/platforms/common"
)

// 分区表来自 `room/v1/Area/getList?show_pinyin=1`，返回 12 个父分区、
// 每个父分区下若干子分区（合计 400+）。实测可直接匿名拉取。
//
// 分区 id 需要 **父分区 + 子分区** 两个值才能查列表，
// 因此编码成 "父_子"（例如网游/英雄联盟 = "2_86"），与抖音的 "1_1010032" 风格一致。

// areaCacheTTL 分区变动很慢，缓存 30 分钟足够。
const areaCacheTTL = 30 * time.Minute

var (
	areaMu       sync.Mutex
	areaCache    []common.CategoryGroup
	areaCachedAt time.Time
)

// FetchCategories 拉取 B 站直播分区树。
func FetchCategories() ([]common.CategoryGroup, error) {
	areaMu.Lock()
	if len(areaCache) > 0 && time.Since(areaCachedAt) < areaCacheTTL {
		groups := areaCache
		areaMu.Unlock()
		return groups, nil
	}
	areaMu.Unlock()

	client := NewClient()
	groups, err := client.fetchAreaList()
	if err != nil {
		return nil, err
	}

	areaMu.Lock()
	areaCache, areaCachedAt = groups, time.Now()
	areaMu.Unlock()
	return groups, nil
}

// fetchAreaList 拉一次分区表并归一化。
func (c *Client) fetchAreaList() ([]common.CategoryGroup, error) {
	var resp struct {
		Code int64 `json:"code"`
		Data []struct {
			ID   any    `json:"id"`
			Name string `json:"name"`
			List []struct {
				ID       any    `json:"id"`
				ParentID any    `json:"parent_id"`
				Name     string `json:"name"`
			} `json:"list"`
		} `json:"data"`
	}

	body, err := c.getRaw(buildURL(urlAreaList, "show_pinyin=1"))
	if err != nil {
		return nil, describe("拉取分区失败", err)
	}
	if err := unmarshalJSON(body, &resp); err != nil {
		return nil, describe("解析分区失败", err)
	}
	if resp.Code != 0 {
		return nil, &apiError{Code: resp.Code, Endpoint: "Area/getList"}
	}

	groups := make([]common.CategoryGroup, 0, len(resp.Data))
	for _, g := range resp.Data {
		if len(g.List) == 0 {
			continue
		}
		groupID := jsonString(g.ID)
		categories := make([]common.Category, 0, len(g.List))
		for _, sub := range g.List {
			childID := jsonString(sub.ID)
			if childID == "" {
				continue
			}
			parentID := jsonString(sub.ParentID)
			if parentID == "" {
				parentID = groupID
			}
			categories = append(categories, common.Category{
				ID:   parentID + "_" + childID,
				Name: strings.TrimSpace(sub.Name),
			})
		}
		if len(categories) == 0 {
			continue
		}
		groups = append(groups, common.CategoryGroup{
			ID:         groupID,
			Name:       strings.TrimSpace(g.Name),
			Categories: categories,
		})
	}

	if len(groups) == 0 {
		return nil, fmt.Errorf("分区表为空")
	}
	return groups, nil
}

// encodeAreaID 把 (父分区, 子分区) 编成 "父_子"。
func encodeAreaID(parentID, areaID int64) string {
	return strconv.FormatInt(parentID, 10) + "_" + strconv.FormatInt(areaID, 10)
}

// splitAreaID 拆 "父_子"；也兼容前端误传的纯子分区 id（此时父分区用空串，
// 由调用方按 area_id 反查）。
func splitAreaID(raw string) (parentID, areaID string, err error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "/category/")
	text = strings.TrimSuffix(text, "/")
	if text == "" {
		return "", "", fmt.Errorf("分区 id 为空")
	}

	if idx := strings.LastIndex(text, "_"); idx > 0 && idx < len(text)-1 {
		return text[:idx], text[idx+1:], nil
	}
	return "", text, nil
}
