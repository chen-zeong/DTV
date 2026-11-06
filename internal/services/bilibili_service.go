// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"fmt"
	"log"
	"strings"

	"dtv/internal/platforms/bilibili"
	"dtv/internal/platforms/common"
)

// BilibiliService 是 B 站平台的 IPC 边界（与 Douyu/Huya/Douyin 一一对应）。
//
// 与其它三个平台的差别：B 站的房间号有"短号 / 真实 room_id"两种，
// 统一在平台层（bilibili.NormalizeRoomID + room_init）里换算，
// 前端只需给短号或完整地址即可。
type BilibiliService struct {
	client  *bilibili.Client
	danmaku *bilibili.DanmakuManager
}

// NewBilibiliService 创建 B 站服务；emit 由 main.go 注入（转成 app.Event.Emit）。
func NewBilibiliService(emit bilibili.EmitFunc) *BilibiliService {
	return &BilibiliService{
		client:  bilibili.NewClient(),
		danmaku: bilibili.NewDanmakuManager(emit),
	}
}

// ServiceShutdown 应用退出时停止弹幕监听。
func (s *BilibiliService) ServiceShutdown() error {
	s.danmaku.StopAll()
	return nil
}

// FetchCategories 返回 B 站直播分区树（Area/getList，带 30 分钟缓存）。
func (s *BilibiliService) FetchCategories() ([]common.CategoryGroup, error) {
	groups, err := bilibili.FetchCategories()
	if err != nil {
		log.Printf("[BilibiliService] 拉分区失败: %v", err)
		return nil, err
	}
	return groups, nil
}

// FetchLiveList 按分区拉一页直播列表（分区 id 形如 "2_86"）。
func (s *BilibiliService) FetchLiveList(areaID string, page int, limit int) (common.StreamerPage, error) {
	areaID = strings.TrimSpace(areaID)
	if areaID == "" {
		return common.StreamerPage{}, fmt.Errorf("缺少 B 站分区 id")
	}
	result, err := s.client.FetchLiveList(areaID, page, limit)
	if err != nil {
		log.Printf("[BilibiliService] 拉直播列表失败 area=%s page=%d: %v", areaID, page, err)
		return common.StreamerPage{}, err
	}
	return result, nil
}

// FetchRoomInfo 拉单个房间的卡片信息。
func (s *BilibiliService) FetchRoomInfo(roomID string) (common.Streamer, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return common.Streamer{}, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.Streamer(roomID)
	if err != nil {
		log.Printf("[BilibiliService] 拉房间信息失败 room=%s: %v", roomID, err)
		return common.Streamer{}, err
	}
	return info, nil
}

// SearchRoom 按关键词搜索直播间。
func (s *BilibiliService) SearchRoom(keyword string) ([]common.SearchHit, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []common.SearchHit{}, nil
	}
	hits, err := s.client.SearchRoom(keyword, 1, 20)
	if err != nil {
		log.Printf("[BilibiliService] 搜索失败 kw=%s: %v", keyword, err)
		return nil, err
	}
	return hits, nil
}

// GetStreamInfo 播放页主入口：房间信息 + 全部清晰度。
func (s *BilibiliService) GetStreamInfo(roomID string, line string) (*common.StreamInfo, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return nil, fmt.Errorf("缺少房间号")
	}
	info, err := s.client.StreamInfo(roomID, strings.TrimSpace(line))
	if err != nil {
		log.Printf("[BilibiliService] 取流信息失败 room=%s line=%s: %v", roomID, line, err)
		return nil, err
	}
	return info, nil
}

// GetStreamURL 只取一条播放地址。
func (s *BilibiliService) GetStreamURL(roomID string, quality string, line string) (string, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return "", fmt.Errorf("缺少房间号")
	}
	url, err := s.client.StreamURL(roomID, strings.TrimSpace(quality), strings.TrimSpace(line))
	if err != nil {
		log.Printf("[BilibiliService] 取流失败 room=%s quality=%s line=%s: %v", roomID, quality, line, err)
		return "", err
	}
	return url, nil
}

// StartDanmaku 开始监听某房间弹幕（会先停掉上一个房间）。
func (s *BilibiliService) StartDanmaku(roomID string) error {
	if err := s.danmaku.Start(roomID); err != nil {
		log.Printf("[BilibiliService] 启动弹幕失败 room=%s: %v", roomID, err)
		return err
	}
	return nil
}

// StopDanmaku 停止弹幕监听。
func (s *BilibiliService) StopDanmaku(roomID string) error {
	s.danmaku.Stop(roomID)
	return nil
}

// RunningDanmakuRoom 返回当前监听房间号（空表示未监听）。
func (s *BilibiliService) RunningDanmakuRoom() string {
	return s.danmaku.RunningRoom()
}

/* ------------------------------------------------------------------ 扫码登录 */

// QrLoginGenerate 申请一个登录二维码（前端把 URL 渲染成二维码给用户扫）。
func (s *BilibiliService) QrLoginGenerate() (*common.QRLoginCode, error) {
	code, err := s.client.QRLoginGenerate()
	if err != nil {
		log.Printf("[BilibiliService] 申请登录二维码失败: %v", err)
		return nil, err
	}
	return code, nil
}

// QrLoginPoll 查询扫码状态。登录成功时会把 Cookie 应用到客户端并返回，
// 之后所有 B 站请求（取流、弹幕、搜索）都会带上登录态。
func (s *BilibiliService) QrLoginPoll(qrcodeKey string) (*common.QRLoginResult, error) {
	result, err := s.client.QRLoginPoll(qrcodeKey)
	if err != nil {
		log.Printf("[BilibiliService] 查询扫码状态失败: %v", err)
		return nil, err
	}
	if result.Status == common.QRStatusSuccess {
		log.Printf("[BilibiliService] 扫码登录成功 user=%q", result.UserName)
	}
	return result, nil
}

// SetBilibiliCookie 应用已保存的登录 Cookie（前端启动时用它恢复登录态）。
//
// 传空字符串表示退出登录：客户端回到未登录状态。
func (s *BilibiliService) SetBilibiliCookie(cookie string) error {
	cookie = strings.TrimSpace(cookie)
	s.client.SetCookie(cookie)
	if cookie != "" {
		log.Printf("[BilibiliService] 已应用登录 Cookie（含 SESSDATA=%t）", bilibili.CookieHasLogin(cookie))
	}
	return nil
}

// BilibiliCookie 返回当前生效的登录 Cookie（未登录为空串）。
func (s *BilibiliService) BilibiliCookie() string {
	return s.client.Cookie()
}

// BilibiliLogout 退出登录。
//
// 与"把 Cookie 置空"的区别：会先调用 B 站 passport 的退出接口让服务端
// 会话失效，再清空本地 Cookie 与 cookie jar。即使服务端调用失败，本地也
// 一定会回到未登录态，返回值只用于提示。
func (s *BilibiliService) BilibiliLogout() error {
	err := s.client.Logout()
	if err != nil {
		log.Printf("[BilibiliService] 退出登录时服务端返回失败（本地已清空）: %v", err)
		return err
	}
	log.Printf("[BilibiliService] 已退出 B 站登录")
	return nil
}

// BilibiliCookieValid 用当前 Cookie 向 B 站确认一次登录态，并返回账号信息。
//
// LoggedIn=false 表示未登录或 Cookie 已失效（前端据此提示重新扫码）。
func (s *BilibiliService) BilibiliCookieValid() (*common.BilibiliProfile, error) {
	profile, err := s.client.LoginProfile()
	if err != nil {
		log.Printf("[BilibiliService] 校验登录态失败: %v", err)
		return nil, err
	}
	return profile, nil
}
