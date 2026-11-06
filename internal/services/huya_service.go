// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"fmt"
	"log"
	"strings"

	"dtv/internal/platforms/common"
	"dtv/internal/platforms/huya"
)

// HuyaService 是虎牙平台的 IPC 边界（与 DouyuService 一一对应）。
type HuyaService struct {
	client  *huya.Client
	danmaku *huya.DanmakuManager
}

// NewHuyaService 创建虎牙服务；emit 由 main.go 注入（转成 app.Event.Emit）。
func NewHuyaService(emit huya.EmitFunc) *HuyaService {
	return &HuyaService{
		client:  huya.NewClient(),
		danmaku: huya.NewDanmakuManager(emit),
	}
}

// ServiceShutdown 应用退出时停止弹幕监听。
func (s *HuyaService) ServiceShutdown() error {
	s.danmaku.StopAll()
	return nil
}

// FetchCategories 返回虎牙分区树（静态表，无需网络）。
func (s *HuyaService) FetchCategories() ([]common.CategoryGroup, error) {
	groups, err := huya.FetchCategories()
	if err != nil {
		log.Printf("[HuyaService] 拉分区失败: %v", err)
		return nil, err
	}
	return groups, nil
}

// FetchLiveList 按分区（iGid）拉某一页直播列表。
//
// 注意：虎牙会忽略 limit，固定按 120 条/页返回，因此一页通常比较"满"。
func (s *HuyaService) FetchLiveList(gid string, page int, limit int) (common.StreamerPage, error) {
	gid = strings.TrimSpace(gid)
	if gid == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少虎牙分区 id")
	}
	pageResult, err := s.client.FetchLiveList(gid, page, limit)
	if err != nil {
		log.Printf("[HuyaService] 拉直播列表失败 gid=%s page=%d: %v", gid, page, err)
		return common.StreamerPage{}, err
	}
	return pageResult, nil
}

// FetchRoomInfo 拉单个房间的卡片信息。
func (s *HuyaService) FetchRoomInfo(roomID string) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.Streamer(roomID)
	if err != nil {
		log.Printf("[HuyaService] 拉房间信息失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return info, nil
}

// SearchAnchor 按关键词搜索主播。
func (s *HuyaService) SearchAnchor(keyword string) ([]common.SearchHit, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []common.SearchHit{}, nil
	}
	hits, err := s.client.SearchAnchor(keyword, 1, 20)
	if err != nil {
		log.Printf("[HuyaService] 搜索失败 kw=%s: %v", keyword, err)
		return nil, err
	}
	return hits, nil
}

// GetStreamInfo 播放页主入口：房间信息 + 全部清晰度 + 全部线路。
func (s *HuyaService) GetStreamInfo(roomID string, line string) (*common.StreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.StreamInfo(roomID, strings.TrimSpace(line))
	if err != nil {
		log.Printf("[HuyaService] 取流信息失败 room=%s line=%s: %v", roomID, line, err)
		return nil, err
	}
	return info, nil
}

// GetStreamURL 只取一条播放地址。
func (s *HuyaService) GetStreamURL(roomID string, quality string, line string) (string, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return "", fmt.Errorf("缺少房间号")
	}
	url, err := s.client.StreamURL(roomID, strings.TrimSpace(quality), strings.TrimSpace(line))
	if err != nil {
		log.Printf("[HuyaService] 取流失败 room=%s quality=%s line=%s: %v", roomID, quality, line, err)
		return "", err
	}
	return url, nil
}

// StartDanmaku 开始监听某房间弹幕（会先停掉上一个房间）。
func (s *HuyaService) StartDanmaku(roomID string) error {
	if err := s.danmaku.Start(roomID); err != nil {
		log.Printf("[HuyaService] 启动弹幕失败 room=%s: %v", roomID, err)
		return err
	}
	return nil
}

// StopDanmaku 停止弹幕监听。
func (s *HuyaService) StopDanmaku(roomID string) error {
	s.danmaku.Stop(roomID)
	return nil
}

// RunningDanmakuRoom 返回当前监听房间号（空表示未监听）。
func (s *HuyaService) RunningDanmakuRoom() string {
	return s.danmaku.RunningRoom()
}
