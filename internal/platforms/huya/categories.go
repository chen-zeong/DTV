package huya

import (
	"embed"
	"encoding/json"
	"fmt"
	"strconv"

	"dtv/internal/platforms/common"
)

//go:embed assets/categories.json
var assetsFS embed.FS

const categoriesAsset = "assets/categories.json"

// categoryFile 是静态分区表的结构（来自虎牙官网的 g_xxx 页面导航）。
type categoryFile struct {
	Title         string `json:"title"`
	Href          string `json:"href"`
	Subcategories []struct {
		Title string `json:"title"`
		Href  string `json:"href"`
		// ID 即 getLiveList 的 iGid
		ID string `json:"id"`
	} `json:"subcategories"`
}

// categoriesOnce 缓存解析结果：分区表是静态资源，一个进程解析一次就够。
var (
	categoryCache []common.CategoryGroup
	categoryErr   error
	categoriesSet bool
)

// FetchCategories 返回虎牙分区树。
//
// 数据来自 embed 的静态 JSON（旧项目同样是把这份表放在前端），
// 分组 id 用下标生成（原表没有分组 id，只有 g_ol 这类 href）。
func FetchCategories() ([]common.CategoryGroup, error) {
	if categoriesSet {
		return categoryCache, categoryErr
	}
	categoriesSet = true

	raw, err := assetsFS.ReadFile(categoriesAsset)
	if err != nil {
		categoryErr = fmt.Errorf("读取虎牙分区表失败: %w", err)
		return nil, categoryErr
	}

	var groups []categoryFile
	if err := json.Unmarshal(raw, &groups); err != nil {
		categoryErr = fmt.Errorf("解析虎牙分区表失败: %w", err)
		return nil, categoryErr
	}

	out := make([]common.CategoryGroup, 0, len(groups))
	for i, group := range groups {
		categoryGroup := common.CategoryGroup{
			// 原表没有分组 id，用序号保证稳定且唯一
			ID:         strconv.Itoa(i + 1),
			Name:       group.Title,
			Categories: make([]common.Category, 0, len(group.Subcategories)),
		}
		for _, sub := range group.Subcategories {
			categoryGroup.Categories = append(categoryGroup.Categories, common.Category{
				ID:   sub.ID,
				Name: sub.Title,
			})
		}
		// 跳过空分组（理论上不会出现）
		if len(categoryGroup.Categories) == 0 {
			continue
		}
		out = append(out, categoryGroup)
	}

	if len(out) == 0 {
		categoryErr = fmt.Errorf("虎牙分区表为空")
		return nil, categoryErr
	}

	categoryCache = out
	return categoryCache, nil
}
