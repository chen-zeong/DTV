// Package huya 移植旧项目 DTV-3.0.3/src-tauri/src/platforms/huya 的全部接口。
//
// 与旧 Rust 实现的对应关系：
//
//	client.go     ← 各文件里重复出现的 UA/Referer/超时设置（此处收敛成一份）
//	categories.go ← 旧前端 web/src/data/categories/huya_categories.json（静态分区表）
//	livelist.go   ← live_list.rs（live.huya.com/liveHttpUI/getLiveList）
//	search.go     ← search.rs（search.cdn.huya.com）
//	stream_url.go ← stream_url.rs（房间详情 + 取流，含 tars 编码）
//	danmaku.go    ← danmaku.rs（弹幕 WS）
//
// # 与旧实现的差异
//
//  1. 分区：旧项目把分区表塞在前端 JSON 里（66KB，前端再解析），
//     这里改成 Go 侧 embed，前端拿统一结构，四个平台的分区来源终于一致。
//  2. 列表分页：旧实现只把 vList 透传，分页信息（iTotalPage）被丢掉，
//     前端只能靠"这一页够不够 20 条"猜；这里把 hasMore 明确算出来。
//  3. 搜索：旧实现返回 HuyaAnchorItem（room_id/avatar/user_name/live_status/title），
//     这里映射成四平台统一的 common.SearchHit。
package huya

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"dtv/internal/platforms/common"
)

const (
	// desktopUA 与旧实现一致（虎牙对浏览器 UA 敏感）。
	desktopUA = common.DefaultUA

	// referer 虎牙接口都要求来自站内页面。
	referer = "https://www.huya.com/"

	// 直播列表接口（旧 live_list.rs 用的就是它）。
	urlLiveList = "https://live.huya.com/liveHttpUI/getLiveList?iGid=%s&iPageNo=%d&iPageSize=%d"

	// 搜索接口（旧 search.rs）。
	urlSearch = "https://search.cdn.huya.com/"

	// 房间详情 / 取流相关接口见 stream_url.go。

	// 默认分页大小：与旧实现一致（rows=20）。
	defaultPageSize = 20

	// 搜索最多一次取多少条。
	searchPageSize = 20
)

// Client 是虎牙接口的调用入口。
//
// 不持有 Wails 依赖，方便单测与 cmd/dtvprobe。
type Client struct {
	http *common.HttpClient
}

// NewClient 创建虎牙客户端。
func NewClient() *Client {
	return &Client{http: common.NewHttpClient()}
}

// ---------------------------------------------------------------- json 取值helper

// jsonString 把任意 JSON 值当字符串取（虎牙同一字段有时是数字有时是字符串）。
func jsonString(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case float64:
		// 大整数用 %f 会带小数，这里只在需要时格式化
		if value == float64(int64(value)) {
			return strconv.FormatInt(int64(value), 10)
		}
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return value.String()
	case bool:
		if value {
			return "1"
		}
		return "0"
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", value)
	}
}

// jsonFloat 取浮点数（虎牙人气值经常是 2.52e+06 这种科学计数法）。
func jsonFloat(v any) float64 {
	switch value := v.(type) {
	case float64:
		return value
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return 0
		}
		return f
	case json.Number:
		f, err := value.Float64()
		if err != nil {
			return 0
		}
		return f
	case bool:
		if value {
			return 1
		}
		return 0
	default:
		return 0
	}
}

// jsonInt 取整数。
func jsonInt(v any) int64 {
	return int64(jsonFloat(v))
}

// jsonBool 取布尔（虎牙经常用 1/0 或 true/false 混着来）。
func jsonBool(v any) bool {
	switch value := v.(type) {
	case bool:
		return value
	case float64:
		return value != 0
	case string:
		return strings.TrimSpace(value) == "1" || strings.ToLower(strings.TrimSpace(value)) == "true"
	default:
		return false
	}
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

