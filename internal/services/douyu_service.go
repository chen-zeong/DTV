// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
//
// 每个方法都会被 wails3 generate bindings 暴露成前端可调用的 TS 函数，
// 因此：方法名用 PascalCase、参数尽量用基本类型、返回值必须可 JSON 序列化。
//
// 业务逻辑全部在 internal/platforms/<平台> 里，Service 只做参数校验 +
// 错误转换，方便用 `go test` 脱离 Wails 回归。
package services

import (
	"fmt"
	"log"
	"strings"

	"dtv/internal/platforms/common"
	"dtv/internal/platforms/douyu"
)

// DouyuService 是斗鱼平台的 IPC 边界。
type DouyuService struct {
	client  *douyu.Client
	danmaku *douyu.DanmakuManager
}

// NewDouyuService 创建斗鱼服务。
//
// emit 由 main.go 注入（内部转成 app.Event.Emit），这样平台层和 Service 层
// 都不需要 import wails，事件名与 payload 形状得以独立测试。
//
// client 可选：main.go 会把同一个 *douyu.Client 同时交给斗鱼服务与直播流
// 中继，两边的登录 Cookie / did / 加密描述符缓存才能保持一致（否则中继用
// 独立 client 取流会退回游客档位，甚至和登录态对不上）。
func NewDouyuService(emit douyu.EmitFunc, client ...*douyu.Client) *DouyuService {
	c := douyu.NewClient()
	if len(client) > 0 && client[0] != nil {
		c = client[0]
	}
	return &DouyuService{
		client:  c,
		danmaku: douyu.NewDanmakuManager(emit),
	}
}

// ServiceShutdown 在应用退出时停止弹幕监听，避免留下半个 websocket 连接。
func (s *DouyuService) ServiceShutdown() error {
	s.danmaku.StopAll()
	return nil
}

// ---------------------------------------------------------------- 分区 / 列表

// FetchCategories 拉斗鱼分区树（一级分区 → 二级分区）。
func (s *DouyuService) FetchCategories() ([]common.CategoryGroup, error) {
	groups, err := s.client.FetchCategories()
	if err != nil {
		log.Printf("[DouyuService] 拉分区失败: %v", err)
		return nil, err
	}
	return groups, nil
}

// FetchThreeCate 拉某个二级分区下的三级分类（如"赛事直播"）。
func (s *DouyuService) FetchThreeCate(cate2ID string) ([]common.Category, error) {
	cate2ID = strings.TrimSpace(cate2ID)
	if cate2ID == "" {
		return nil, fmt.Errorf("缺少二级分区 id")
	}
	items, err := s.client.FetchThreeCate(cate2ID)
	if err != nil {
		log.Printf("[DouyuService] 拉三级分区失败 cate2=%s: %v", cate2ID, err)
		return nil, err
	}
	return items, nil
}

// FetchLiveList 按二级分区拉直播列表（分页）。
//
// page 从 1 开始；limit<=0 时使用默认页大小。
func (s *DouyuService) FetchLiveList(cate2ID string, page int, limit int) (common.StreamerPage, error) {
	cate2ID = strings.TrimSpace(cate2ID)
	if cate2ID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少二级分区 id")
	}
	rooms, err := s.client.FetchLiveList(cate2ID, page, limit)
	if err != nil {
		log.Printf("[DouyuService] 拉直播列表失败 cate2=%s page=%d: %v", cate2ID, page, err)
		return common.StreamerPage{}, err
	}
	return rooms, nil
}

// FetchLiveListForCate3 按三级分区拉直播列表（分页）。
func (s *DouyuService) FetchLiveListForCate3(cate3ID string, page int, limit int) (common.StreamerPage, error) {
	cate3ID = strings.TrimSpace(cate3ID)
	if cate3ID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少三级分区 id")
	}
	rooms, err := s.client.FetchLiveListForCate3(cate3ID, page, limit)
	if err != nil {
		log.Printf("[DouyuService] 拉三级分区列表失败 cate3=%s page=%d: %v", cate3ID, page, err)
		return common.StreamerPage{}, err
	}
	return rooms, nil
}

// ---------------------------------------------------------------- 房间 / 搜索

// FetchRoomInfo 拉单个房间的卡片信息（关注列表刷新用）。
func (s *DouyuService) FetchRoomInfo(roomID string) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.FetchRoomInfo(roomID)
	if err != nil {
		log.Printf("[DouyuService] 拉房间信息失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return *info, nil
}

// SearchAnchor 按关键词搜索主播。
func (s *DouyuService) SearchAnchor(keyword string) ([]common.SearchHit, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []common.SearchHit{}, nil
	}
	hits, err := s.client.SearchAnchor(keyword, 1, 20)
	if err != nil {
		log.Printf("[DouyuService] 搜索失败 kw=%s: %v", keyword, err)
		return nil, err
	}
	return hits, nil
}

// ---------------------------------------------------------------- 取流

// GetStreamInfo 播放页主入口：房间信息 + 所有清晰度 + 所有线路。
//
// line 为空时用斗鱼默认线路；切换线路/清晰度时前端重新调用本方法即可。
func (s *DouyuService) GetStreamInfo(roomID string, line string) (*common.StreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.StreamInfo(roomID, strings.TrimSpace(line))
	if err != nil {
		log.Printf("[DouyuService] 取流信息失败 room=%s line=%s: %v", roomID, line, err)
		return nil, err
	}
	return info, nil
}

// GetStreamURL 只取一条播放地址（等价旧接口 get_stream_url / *_with_quality）。
//
// quality 接受 source/high/standard，也接受 原画/高清/标清；为空时取最高码率。
func (s *DouyuService) GetStreamURL(roomID string, quality string, line string) (string, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return "", fmt.Errorf("缺少房间号")
	}
	url, err := s.client.StreamURL(roomID, strings.TrimSpace(quality), strings.TrimSpace(line))
	if err != nil {
		log.Printf("[DouyuService] 取流失败 room=%s quality=%s line=%s: %v", roomID, quality, line, err)
		return "", err
	}
	return url, nil
}

// ---------------------------------------------------------------- 弹幕

// StartDanmaku 开始监听某房间的弹幕（会先停掉上一个房间）。
//
// 弹幕通过事件推给前端：`danmaku-message`（全局）与 `danmaku-<roomId>`。
func (s *DouyuService) StartDanmaku(roomID string) error {
	if err := s.danmaku.Start(roomID); err != nil {
		log.Printf("[DouyuService] 启动弹幕失败 room=%s: %v", roomID, err)
		return err
	}
	return nil
}

// StopDanmaku 停止弹幕监听（roomID 仅用于日志，实际永远停当前连接）。
func (s *DouyuService) StopDanmaku(roomID string) error {
	s.danmaku.Stop(roomID)
	return nil
}

// RunningDanmakuRoom 返回当前正在监听的房间号（空表示未监听）。
func (s *DouyuService) RunningDanmakuRoom() string {
	return s.danmaku.RunningRoom()
}

/* ------------------------------------------------------------------ 扫码登录 */

// QrLoginGenerate 申请一个斗鱼登录二维码。
func (s *DouyuService) QrLoginGenerate() (*common.QRLoginCode, error) {
	code, err := s.client.QRLoginGenerate()
	if err != nil {
		log.Printf("[DouyuService] 申请登录二维码失败: %v", err)
		return nil, err
	}
	return code, nil
}

// QrLoginPoll 查询扫码状态。成功时客户端已经应用登录 Cookie，
// 后续取流、弹幕、搜索请求都会带上登录态。
func (s *DouyuService) QrLoginPoll(qrcodeKey string) (*common.QRLoginResult, error) {
	result, err := s.client.QRLoginPoll(qrcodeKey)
	if err != nil {
		log.Printf("[DouyuService] 查询扫码状态失败: %v", err)
		return nil, err
	}
	if result.Status == common.QRStatusSuccess {
		log.Printf("[DouyuService] 斗鱼扫码登录成功 user=%q", result.UserName)
	}
	return result, nil
}

// SetDouyuCookie 应用已保存的登录 Cookie（空串表示退出登录）。
func (s *DouyuService) SetDouyuCookie(cookie string) error {
	cookie = strings.TrimSpace(cookie)
	s.client.SetCookie(cookie)
	if cookie != "" {
		log.Printf("[DouyuService] 已应用斗鱼登录 Cookie（含登录字段=%t）",
			douyu.CookieHasLogin(cookie))
	}
	return nil
}

// DouyuCookie 返回当前生效的斗鱼登录 Cookie。
func (s *DouyuService) DouyuCookie() string {
	return s.client.Cookie()
}

// DouyuCookieValid 判断当前 Cookie 是否含登录字段。
//
// 斗鱼没有稳定的昵称/头像接口，这里只做本地字段判断；网络校验由
// RefreshDouyuCookie 完成（续期成功也说明登录态可用）。
func (s *DouyuService) DouyuCookieValid() (*common.DouyuProfile, error) {
	return s.client.CookieValid(), nil
}

// RefreshDouyuCookie 用 passport safeAuth 续期一次 Cookie。
//
// 失败时返回原 Cookie，前端可以忽略错误并继续用旧 Cookie（可能降级为游客）。
func (s *DouyuService) RefreshDouyuCookie() (string, error) {
	cookie, err := s.client.RefreshCookie()
	if err != nil {
		log.Printf("[DouyuService] 斗鱼 Cookie 续期失败: %v", err)
		return cookie, err
	}
	return cookie, nil
}
