// Package common 存放各平台共享的基础设施：HTTP 客户端、归一化类型、弹幕事件。
//
// 这些 struct 的 json tag 必须与 frontend/src/api/types.ts 完全一致 ——
// Wails v3 的绑定生成器用 **json tag** 作为 TS 字段名（见
// wails-3.0.0/v3/internal/generator/render/templates/models.ts.tmpl），
// 事件 payload 也是直接 JSON 序列化，因此 tag 即契约。
package common

// LivePlatform 与前端 LIVE_PLATFORMS 的取值一致。
type LivePlatform string

const (
	PlatformDouyu    LivePlatform = "douyu"
	PlatformHuya     LivePlatform = "huya"
	PlatformDouyin   LivePlatform = "douyin"
	PlatformBilibili LivePlatform = "bilibili"
)

// Category 一级分区下的二级分区（前端 CategoryBar 的按钮）。
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CategoryGroup 分区分组（斗鱼对应 cate1，"热门游戏"/"娱乐天地"…）。
type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Categories []Category `json:"categories"`
}

// Streamer 主播卡片数据。
type Streamer struct {
	ID           string `json:"id"`
	Platform     string `json:"platform"`
	Nickname     string `json:"nickname"`
	Title        string `json:"title"`
	Cover        string `json:"cover"`
	Avatar       string `json:"avatar"`
	Viewers      int64  `json:"viewers"`
	CategoryName string `json:"categoryName"`
	IsLive       bool   `json:"isLive"`
}

// StreamerPage 一页主播卡片 + 分页信息。
//
// 前端列表是无限滚动，需要知道"还有没有下一页"，
// 因此不能只返回数组：斗鱼目录接口自带 pgcnt（总页数），
// 这里统一成 hasMore 交给前端判断是否继续加载。
type StreamerPage struct {
	Items   []Streamer `json:"items"`
	Page    int        `json:"page"`
	HasMore bool       `json:"hasMore"`
	// TotalPages 为 0 表示上游没给总页数（此时 hasMore 由"本页是否满页"推断）。
	TotalPages int `json:"totalPages,omitempty"`
}

// StreamVariant 一个清晰度档位。
//
// 斗鱼的 ID 使用平台下发的 rate 数字（如 "0" 原画、"4" 蓝光4M）；
// 其它平台沿用 source/high/standard。ID 会被前端持久化，必须跨房间稳定。
//
// URLs 是同一档位在多个 CDN 上解析出的地址（斗鱼每个 CDN 可能确认不同档位，
// 这里只放同一实际档位的地址，顺序与平台线路顺序一致）。URL 是其中第一条，
// 兼容只认单个地址的播放器/中继。
type StreamVariant struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	URL    string   `json:"url"`
	Format string   `json:"format"`
	URLs   []string `json:"urls,omitempty"`
	// AppliedRate 是服务端确认的实际档位；nil 表示响应没有给出可用确认。
	AppliedRate *int `json:"appliedRate,omitempty"`
	// Unconfirmed 表示请求了档位但服务端没有给出可确认的实际档位。
	Unconfirmed bool `json:"unconfirmed,omitempty"`
}

// LineOption 一条线路（斗鱼 cdn、虎牙 tx/al/hs…）。
type LineOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// StreamInfo 播放页所需的房间详情。
type StreamInfo struct {
	RoomID   string          `json:"roomId"`
	Platform string          `json:"platform"`
	Title    string          `json:"title"`
	Nickname string          `json:"nickname"`
	Avatar   string          `json:"avatar"`
	IsLive   bool            `json:"isLive"`
	Variants []StreamVariant `json:"variants"`
	Lines    []LineOption    `json:"lines"`
}

// SearchHit 搜索结果条目。
type SearchHit struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Title    string `json:"title"`
	Avatar   string `json:"avatar"`
	IsLive   bool   `json:"isLive"`
}

// DanmakuKind 弹幕类型，取值与前端 DanmakuKind 一致。
type DanmakuKind string

const (
	DanmakuChat   DanmakuKind = "chat"
	DanmakuGift   DanmakuKind = "gift"
	DanmakuSystem DanmakuKind = "system"
	DanmakuEnter  DanmakuKind = "enter"
)

// DanmakuMessage 归一化后的弹幕。
type DanmakuMessage struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Content  string `json:"content"`
	Level    int    `json:"level"`
	Color    string `json:"color,omitempty"`
	Kind     string `json:"kind"`
	At       int64  `json:"at"`
}

// DanmakuEvent 是弹幕事件的完整 payload。
//
// 事件名沿用旧项目的 `danmaku-message`（全局）+ `danmaku-<roomId>`（按房间），
// 但因为多个窗口共享同一条事件总线，payload 里必须带上 roomId，
// 否则前端在切换房间时会收到上一个房间的残留弹幕。
type DanmakuEvent struct {
	RoomID   string         `json:"roomId"`
	Platform string         `json:"platform"`
	Message  DanmakuMessage `json:"message"`
}

// QRLoginCode 扫码登录的二维码内容。
//
// URL 是二维码里真正要编码的字符串（手机扫码后跳转的地址）；
// Key 只用于轮询扫码状态，不要展示给用户。
type QRLoginCode struct {
	URL string `json:"url"`
	Key string `json:"key"`
	// ExpiresIn 二维码有效期（秒）；0 表示上游未说明。
	ExpiresIn int `json:"expiresIn"`
}

// QR 扫码状态取值（前端按这个渲染不同文案）。
const (
	QRStatusPending = "pending" // 等待扫码
	QRStatusScanned = "scanned" // 已扫码，等待手机端确认
	QRStatusExpired = "expired" // 二维码已失效，需要刷新
	QRStatusSuccess = "success" // 登录成功，Cookie 已就绪
	QRStatusError   = "error"   // 上游返回了无法识别的状态
)

// QRLoginResult 一次扫码状态查询的结果。
type QRLoginResult struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	// Cookie 仅在 Status=success 时有值，格式与浏览器 Cookie 头一致。
	Cookie string `json:"cookie,omitempty"`
	// UserName / Avatar 登录成功后顺带查到的账号信息（失败时为空）。
	UserName string `json:"userName,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

// BilibiliProfile 当前 B 站账号信息（用于启动时校验保存的 Cookie 是否仍有效）。
type BilibiliProfile struct {
	// LoggedIn 为 false 表示未登录或 Cookie 已失效。
	LoggedIn bool   `json:"loggedIn"`
	UserName string `json:"userName,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

// DouyuProfile 当前斗鱼账号信息。
//
// 斗鱼没有像 B 站 nav 那样稳定的“昵称/头像”接口，登录态以 Cookie 里是否
// 存在 dy_auth / acf_auth / acf_jwt_token 为准；昵称能取到就填，取不到留空。
type DouyuProfile struct {
	LoggedIn bool   `json:"loggedIn"`
	UserName string `json:"userName,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}
