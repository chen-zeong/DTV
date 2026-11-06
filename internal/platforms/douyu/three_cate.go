package douyu

import (
	"fmt"

	"dtv/internal/platforms/common"
)

// threeCateResponse 对应 capi.douyucdn.cn/api/v1/getThreeCate。
//
// 注意：data 直接就是数组（不是对象），旧 Rust 的解析与之一致。
type threeCateResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
	Data  []struct {
		ID   any    `json:"id"`
		Name string `json:"name"`
	} `json:"data"`
}

// FetchThreeCate 拉某个二级分区下的三级分区分组（"赛事直播"/"大神教学"…）。
//
// tag_id 传二级分区 id（例如 1=英雄联盟），返回的 id 可直接用于
// FetchLiveListForCate3。
func (c *Client) FetchThreeCate(cate2ID string) ([]common.Category, error) {
	if cate2ID == "" {
		return nil, fmt.Errorf("缺少二级分区 id")
	}

	var payload threeCateResponse
	headers := map[string]string{"User-Agent": desktopUA}
	if err := c.http.GetJSON(fmt.Sprintf(urlThreeCate, cate2ID), headers, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, fmt.Errorf("斗鱼三级分区接口返回错误 error=%d msg=%s", payload.Error, payload.Msg)
	}

	// 空数组是正常情况（该分区暂无三级分类），返回空切片而不是错误。
	out := make([]common.Category, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := jsonString(item.ID)
		if id == "" {
			continue
		}
		out = append(out, common.Category{ID: id, Name: item.Name})
	}
	return out, nil
}
