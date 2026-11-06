package douyin

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"dtv/internal/platforms/common"
)

// 抖音的分区表是**前端静态数据**（旧项目里就是
// web/src/platforms/douyin/douyinCategoriesData.ts 的硬编码数组），
// 抖音官方没有提供分区列表接口。
//
// 因此这里把它转成 JSON 内嵌进来（assets/categories.json），
// 结构与虎牙的静态分区表一致，加载逻辑也复用同一套。

//go:embed assets/categories.json
var categoriesJSON []byte

// categoriesCache 避免每次调用都重新解析（分区表不会变）。
var (
	categoriesCache []common.CategoryGroup
	categoriesOnce  sync.Once
	categoriesErr   error
)

// FetchCategories 返回抖音的分区树。
//
// Category.ID 形如 "1_1010032"（partition_type_partition），
// 可直接传给 FetchLiveList。
func FetchCategories() ([]common.CategoryGroup, error) {
	categoriesOnce.Do(func() {
		var groups []common.CategoryGroup
		if err := json.Unmarshal(categoriesJSON, &groups); err != nil {
			categoriesErr = fmt.Errorf("解析抖音分区表失败: %w", err)
			return
		}
		categoriesCache = groups
	})
	if categoriesErr != nil {
		return nil, categoriesErr
	}
	return categoriesCache, nil
}
