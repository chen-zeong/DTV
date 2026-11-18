// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"errors"
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

// DouyinOptions 是抖音服务的可选依赖。
type DouyinOptions struct {
	// Emit 事件回调（必填）。
	Emit douyin.EmitFunc
	// CaptchaResolver 弹窗式验证码解决器（可选）：房间页被拦时弹原生窗口
	// 让用户过验证码，拿到内部 roomId 后继续取流。
	CaptchaResolver douyin.CaptchaResolver
	// RoomIDResolver 静默 roomId 解析器（可选）：**不弹窗**，由宿主用常驻
	// 浏览器会话解析。用于关注列表批量刷新——用户过一次验证码后浏览器
	// 会话已被放行，任意房间都能静默取到 roomId。
	RoomIDResolver douyin.RoomIDResolver
}

// NewDouyinService 创建抖音服务。
//
// opts.Resolver 可选：注入后，抖音房间页被验证码拦截时会弹窗让用户过验证码
// 拿到内部 roomId 后继续取流；不注入则退回直接报错。
func NewDouyinService(opts DouyinOptions) *DouyinService {
	client := douyin.NewClient()
	s := &DouyinService{
		client:  client,
		danmaku: douyin.NewDanmakuManager(opts.Emit, client),
	}
	if opts.CaptchaResolver != nil {
		client.SetCaptchaResolver(opts.CaptchaResolver)
	}
	if opts.RoomIDResolver != nil {
		client.SetRoomIDResolver(opts.RoomIDResolver)
	}
	return s
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
//
// force 为 true 时忽略后端缓存的未开播状态，强制重新向上游验证直播状态。
// 供播放页的「立即刷新」使用，否则 offlineTrustTTL（60s）内点击不会
// 发出任何真实请求。
func (s *DouyinService) FetchRoomInfo(roomID string, force bool) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}

	// allowPopup: false，被拦截时前端显示"暂时无法获取状态"
	info, err := s.client.Streamer(roomID, false, force)
	if err != nil {
		if errors.Is(err, douyin.ErrRoomOffline) {
			return common.Streamer{
				ID:       roomID,
				Platform: string(common.PlatformDouyin),
				IsLive:   false,
			}, nil
		}
		log.Printf("[DouyinService] 拉房间信息失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return info, nil
}

// SearchRoom 按房间号/链接搜索单个房间
func (s *DouyinService) SearchRoom(roomID string) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}

	// allowPopup: true，被拦截时弹验证码窗口
	info, err := s.client.Streamer(roomID, true, false)
	if err != nil {
		if errors.Is(err, douyin.ErrRoomOffline) {
			return common.Streamer{
				ID:       roomID,
				Platform: string(common.PlatformDouyin),
				IsLive:   false,
			}, nil
		}
		log.Printf("[DouyinService] 搜索房间失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return info, nil
}

// GetStreamInfo 播放页主入口：房间信息 + 全部清晰度。
//
// force 为 true 时忽略后端缓存的未开播状态，强制重新向上游验证直播状态。
func (s *DouyinService) GetStreamInfo(roomID string, line string, force bool) (*common.StreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}

	info, err := s.client.StreamInfo(roomID, strings.TrimSpace(line), force)
	if err != nil {
		if errors.Is(err, douyin.ErrRoomOffline) {
			return &common.StreamInfo{
				RoomID:   roomID,
				Platform: string(common.PlatformDouyin),
				IsLive:   false,
				Variants: []common.StreamVariant{},
				Lines:    []common.LineOption{},
			}, nil
		}
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
