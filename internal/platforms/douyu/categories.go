package douyu

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"dtv/internal/platforms/common"
)

// cate1Info / cate2Info 对应 m.douyu.com/api/cate/list 里的扁平条目。
type cate1Info struct {
	Cate1ID   any    `json:"cate1Id"`
	Cate1Name string `json:"cate1Name"`
	ShortName string `json:"shortName"`
}

type cate2Info struct {
	Cate1ID   any    `json:"cate1Id"`
	Cate2ID   any    `json:"cate2Id"`
	Cate2Name string `json:"cate2Name"`
	ShortName string `json:"shortName"`
	Icon      string `json:"icon"`
}

// cateListResponse 对应 m.douyu.com/api/cate/list。
//
// 真实响应里 data 是扁平的 cate1Info + cate2Info 两个数组，cate2 通过 cate1Id 关联。
type cateListResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Cate1Info []cate1Info `json:"cate1Info"`
		Cate2Info []cate2Info `json:"cate2Info"`
	} `json:"data"`
}

// buildCategoryGroups 把扁平的 cate1/cate2 组装成前端用的分组树。
//
// 两处去重（对应线上真实数据）：
//  1. 同一个 cate2Id 在 cate2Info 里出现多次时只保留第一次；
//  2. 「娱乐天地」(cate1Id=2) 的「一起看」：历史接口不下发，旧实现硬编码补了一个；
//     但现在接口会间歇性下发（ID 208），再补就会变成两个同 id 的 chip。
//     因此只在确实不存在时补一次。
func buildCategoryGroups(cate1List []cate1Info, cate2List []cate2Info) []common.CategoryGroup {
	groups := make([]common.CategoryGroup, 0, len(cate1List))
	for _, c1 := range cate1List {
		cate1ID := jsonString(c1.Cate1ID)
		if cate1ID == "" {
			continue
		}

		group := common.CategoryGroup{
			ID:         cate1ID,
			Name:       c1.Cate1Name,
			Categories: make([]common.Category, 0, 32),
		}

		seen := make(map[string]struct{}, len(cate2List))
		hasTogetherWatch := false
		for _, c2 := range cate2List {
			if jsonString(c2.Cate1ID) != cate1ID {
				continue
			}
			cate2ID := jsonString(c2.Cate2ID)
			if cate2ID == "" {
				continue
			}
			if _, exists := seen[cate2ID]; exists {
				continue
			}
			seen[cate2ID] = struct{}{}
			name := c2.Cate2Name
			if name == "一起看" {
				// 同名的「一起看」只保留一个（即使上游给了不同 id）。
				if hasTogetherWatch {
					continue
				}
				hasTogetherWatch = true
			}
			group.Categories = append(group.Categories, common.Category{
				ID:   cate2ID,
				Name: name,
			})
		}

		// 旧接口不下发「一起看」，网页端有该入口；只有缺失时才补。
		if cate1ID == "2" && !hasTogetherWatch {
			group.Categories = append(group.Categories, common.Category{ID: "208", Name: "一起看"})
		}

		if len(group.Categories) > 0 {
			groups = append(groups, group)
		}
	}
	return groups
}

// cate2Aliases 把老版订阅里的 shortName / 分区名 / 旧 id 映射到当前 cate2Id。
//
// 老 Tauri 版的斗鱼订阅存的是 shortName（例如 LOL、yz），而当前目录接口
// 需要数字 cate2Id（LOL → 1）。导入老配置后订阅能显示、但拉不到列表，
// 就是这里缺了映射。分类表是静态的，进程内缓存一份即可。
var (
	cate2AliasMu sync.RWMutex
	cate2Aliases map[string]string
)

func rememberCate2Aliases(list []cate2Info) {
	aliases := make(map[string]string, len(list)*3)
	for _, c2 := range list {
		id := jsonString(c2.Cate2ID)
		if id == "" {
			continue
		}
		for _, alias := range []string{id, c2.ShortName, c2.Cate2Name} {
			alias = strings.ToLower(strings.TrimSpace(alias))
			if alias == "" {
				continue
			}
			if _, exists := aliases[alias]; !exists {
				aliases[alias] = id
			}
		}
	}
	cate2AliasMu.Lock()
	cate2Aliases = aliases
	cate2AliasMu.Unlock()
}

// ensureCate2Aliases 按需拉一次分区表，供老 shortName 反查数字 id。
func (c *Client) ensureCate2Aliases() {
	cate2AliasMu.RLock()
	loaded := cate2Aliases != nil
	cate2AliasMu.RUnlock()
	if loaded {
		return
	}

	var payload cateListResponse
	headers := map[string]string{
		"User-Agent": mobileUA,
		"Referer":    "https://m.douyu.com/",
	}
	if err := c.http.GetJSON(urlCateList, headers, &payload); err != nil || payload.Code != 0 {
		return
	}
	rememberCate2Aliases(payload.Data.Cate2Info)
}

// resolveCate2ID 把老 shortName / 分区名换成当前数字 cate2Id。
func (c *Client) resolveCate2ID(raw string) string {
	id := strings.TrimSpace(raw)
	if id == "" {
		return id
	}
	// 当前接口 id 都是纯数字；直接放行。
	if _, err := strconv.Atoi(id); err == nil {
		return id
	}

	cate2AliasMu.RLock()
	aliases := cate2Aliases
	cate2AliasMu.RUnlock()
	if aliases != nil {
		if mapped, ok := aliases[strings.ToLower(id)]; ok {
			return mapped
		}
		return id
	}

	c.ensureCate2Aliases()
	cate2AliasMu.RLock()
	defer cate2AliasMu.RUnlock()
	if mapped, ok := cate2Aliases[strings.ToLower(id)]; ok {
		return mapped
	}
	return id
}

// FetchCategories 拉分区树：cate1 → cate2。
//
// 与旧实现的差异：旧代码把结果当成 cate1/cate2 两级结构返回给前端，这里直接
// 映射到新前端的 CategoryGroup（id/name/categories），语义一致。
func (c *Client) FetchCategories() ([]common.CategoryGroup, error) {
	var payload cateListResponse
	headers := map[string]string{
		"User-Agent": mobileUA,
		"Referer":    "https://m.douyu.com/",
	}
	if err := c.http.GetJSON(urlCateList, headers, &payload); err != nil {
		return nil, err
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("斗鱼分区接口返回错误 code=%d msg=%s", payload.Code, payload.Msg)
	}

	rememberCate2Aliases(payload.Data.Cate2Info)
	groups := buildCategoryGroups(payload.Data.Cate1Info, payload.Data.Cate2Info)
	if len(groups) == 0 {
		return nil, fmt.Errorf("斗鱼分区接口返回空列表")
	}
	return groups, nil
}
