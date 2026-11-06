// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"fmt"
	"log"
	"strings"

	"dtv/internal/platforms/common"
	"dtv/internal/platforms/douyin"
)

// DouyinService 是抖音平台的 IPC 边界（与 DouyuService / HuyaService 一一对应）。
//
// 抖音没有"多线路"概念，也没有搜索接口（旧项目里搜索框只接受直播间号），
// 因此这里的方法集比斗鱼/虎牙略窄。
type DouyinService struct {
	client  *douyin.Client
	danmaku *douyin.DanmakuManager
}

// NewDouyinService 创建抖音服务；emit 由 main.go 注入（转成 app.Event.Emit）。
func NewDouyinService(emit douyin.EmitFunc) *DouyinService {
	return &DouyinService{
		client:  douyin.NewClient(),
		danmaku: douyin.NewDanmakuManager(emit),
	}
}

// ServiceShutdown 应用退出时停止弹幕监听。
func (s *DouyinService) ServiceShutdown() error {
	s.danmaku.StopAll()
	return nil
}

// FetchCategories 返回抖音分区树（静态表，无需网络）。
func (s *DouyinService) FetchCategories() ([]common.CategoryGroup, error) {
	groups, err := douyin.FetchCategories()
	if err != nil {
		log.Printf("[DouyinService] 拉分区失败: %v", err)
		return nil, err
	}
	return groups, nil
}

// FetchLiveList 按分区拉某一页直播，cateID 形如 "1_1010032"。
func (s *DouyinService) FetchLiveList(cateID string, page int, limit int) (common.StreamerPage, error) {
	cateID = strings.TrimSpace(cateID)
	if cateID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少抖音分区 id")
	}

	result, err := s.client.FetchLiveList(cateID, page, limit)
	if err != nil {
		log.Printf("[DouyinService] 拉直播列表失败 cate=%s page=%d: %v", cateID, page, err)
		return common.StreamerPage{}, err
	}
	return result, nil
}

// FetchRoomInfo 拉单个房间的卡片信息。
func (s *DouyinService) FetchRoomInfo(roomID string) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}

	info, err := s.client.Streamer(roomID)
	if err != nil {
		log.Printf("[DouyinService] 拉房间信息失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return info, nil
}

// GetStreamInfo 播放页主入口：房间信息 + 全部清晰度。
func (s *DouyinService) GetStreamInfo(roomID string, line string) (*common.StreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}

	info, err := s.client.StreamInfo(roomID, strings.TrimSpace(line))
	if err != nil {
		log.Printf("[DouyinService] 取流信息失败 room=%s: %v", roomID, err)
		return nil, err
	}
	return info, nil
}

// GetStreamURL 只取一条播放地址。
func (s *DouyinService) GetStreamURL(roomID string, quality string, line string) (string, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return "", fmt.Errorf("缺少房间号")
	}

	url, err := s.client.StreamURL(roomID, strings.TrimSpace(quality), strings.TrimSpace(line))
	if err != nil {
		log.Printf("[DouyinService] 取流失败 room=%s quality=%s: %v", roomID, quality, err)
		return "", err
	}
	return url, nil
}

// StartDanmaku 开始监听某房间弹幕（会先停掉上一个房间）。
func (s *DouyinService) StartDanmaku(roomID string) error {
	if err := s.danmaku.Start(roomID); err != nil {
		log.Printf("[DouyinService] 启动弹幕失败 room=%s: %v", roomID, err)
		return err
	}
	return nil
}

// StopDanmaku 停止弹幕监听。
func (s *DouyinService) StopDanmaku(roomID string) error {
	s.danmaku.Stop(roomID)
	return nil
}

// RunningDanmakuRoom 返回当前监听房间号（空表示未监听）。
func (s *DouyinService) RunningDanmakuRoom() string {
	return s.danmaku.RunningRoom()
}
