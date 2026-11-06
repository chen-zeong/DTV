// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	lanSyncKind        = "dtv-lan-sync"
	lanSyncBeaconKind  = "dtv-lan-sync-beacon"
	lanSyncVersion     = 1
	lanSyncPort        = 38999
	lanSyncDiscoverNL  = 38998
	lanSyncHTTPPath    = "/dtv-sync"
	lanSyncPayloadPath = "/dtv-sync/payload"
	lanSyncDiscoverMsg = "DTV_LAN_SYNC_DISCOVER_V1"
	// lanSyncDefaultToken 是固定的同步令牌，与老 Tauri 版一致（旧版 DEFAULT_TOKEN = "dtv"）。
	// 局域网同步只服务私有网段，鉴权用固定令牌即可；不再要求用户输入配对码。
	lanSyncDefaultToken = "dtv"
)

// LanSyncSource 是分享端的来源信息（与老项目字段保持一致）。
type LanSyncSource struct {
	Client     string  `json:"client"`
	AppVersion *string `json:"appVersion"`
}

// LanSyncPayload 是真正通过局域网传输的完整配置。
type LanSyncPayload struct {
	Kind       string            `json:"kind"`
	Version    int               `json:"version"`
	ExportedAt string            `json:"exportedAt"`
	Source     LanSyncSource     `json:"source"`
	Entries    map[string]string `json:"entries"`
}

// LanSyncSummary 用于在接收端先看清“有什么”，避免直接覆盖本地数据。
type LanSyncSummary struct {
	Follows       int `json:"follows"`
	FollowFolders int `json:"followFolders"`
	FollowOrder   int `json:"followOrder"`
	Subscriptions int `json:"subscriptions"`
	DanmuKeywords int `json:"danmuKeywords"`
	TotalBytes    int `json:"totalBytes"`
}

// LanSyncManifest 是 /dtv-sync 返回的轻量清单。
type LanSyncManifest struct {
	Kind       string         `json:"kind"`
	Version    int            `json:"version"`
	ExportedAt string         `json:"exportedAt"`
	Source     LanSyncSource  `json:"source"`
	Summary    LanSyncSummary `json:"summary"`
}

// LanSyncServerInfo 是开启共享后返回给前端的连接信息。
type LanSyncServerInfo struct {
	Port    int      `json:"port"`
	Hosts   []string `json:"hosts"`
	Token   string   `json:"token"`
	BaseURL string   `json:"baseUrl"`
	Name    string   `json:"name"`
}

// LanSyncPeer 是局域网里被发现的一台共享端。
type LanSyncPeer struct {
	Name    string `json:"name"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
	BaseURL string `json:"baseUrl"`
	Version int    `json:"version"`
}

type lanSyncBeacon struct {
	Kind    string `json:"kind"`
	Version int    `json:"version"`
	Name    string `json:"name"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
	Path    string `json:"path"`
}

// LanSyncService 提供“局域网数据同步”的服务端和客户端能力。
//
// 服务端固定监听 TCP 38999（与老项目一致），UDP 38998 只用于发现；
// HTTP 接口为 /dtv-sync（清单）与 /dtv-sync/payload（完整数据）。
//
// 安全边界：
//   - 只接受来自私有网段 / 回环地址的请求；
//   - 令牌固定为 "dtv"（可用 DTV_LAN_SYNC_TOKEN 覆盖），与老 Tauri 版一致；
//   - 不做通用文件服务，只返回内存里的这一份 payload。
type LanSyncService struct {
	mu       sync.Mutex
	server   *http.Server
	listener net.Listener
	udp      *net.UDPConn
	stopCh   chan struct{}
	payload  *LanSyncPayload
	info     *LanSyncServerInfo
	token    string
	client   *http.Client
}

// NewLanSyncService 创建局域网同步服务。
func NewLanSyncService() *LanSyncService {
	// 局域网同步必须直连：系统代理通常只处理公网流量，把 192.168.x.x
	// 交给代理会直接失败。
	transport := &http.Transport{
		Proxy:                 nil,
		MaxIdleConns:          8,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
	}
	return &LanSyncService{
		client: &http.Client{Transport: transport, Timeout: 6 * time.Second},
	}
}

// StartServer 开启共享。
func (s *LanSyncService) StartServer(payload LanSyncPayload) (*LanSyncServerInfo, error) {
	if err := validateLanSyncPayload(&payload); err != nil {
		return nil, err
	}

	// 重新开启时先停掉上一份快照。
	_ = s.StopServer()

	listener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", lanSyncPort))
	if err != nil {
		return nil, fmt.Errorf("端口 %d 被占用，请关闭其它 DTV 实例后重试：%w", lanSyncPort, err)
	}

	token := lanSyncToken()
	if token == "" {
		token = lanSyncDefaultToken
	}
	hosts := lanSyncHosts()
	name := lanSyncDeviceName()
	info := &LanSyncServerInfo{
		Port:    lanSyncPort,
		Hosts:   hosts,
		Token:   token,
		BaseURL: fmt.Sprintf("http://%s:%d", firstShareableHost(hosts), lanSyncPort),
		Name:    name,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(lanSyncHTTPPath, s.handleManifest)
	mux.HandleFunc(lanSyncPayloadPath, s.handlePayload)

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 8 * time.Second,
		IdleTimeout:       30 * time.Second,
	}

	s.mu.Lock()
	s.listener = listener
	s.server = server
	s.payload = &payload
	s.info = info
	s.token = token
	s.stopCh = make(chan struct{})
	stopCh := s.stopCh
	s.mu.Unlock()

	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			fmt.Printf("[LanSync] HTTP 服务退出: %v\n", serveErr)
		}
	}()

	// UDP 只负责“被发现”。绑定失败不阻断 HTTP 分享，用户仍可手动输入 IP。
	if udp, udpErr := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: lanSyncDiscoverNL}); udpErr == nil {
		s.mu.Lock()
		s.udp = udp
		s.mu.Unlock()
		go s.serveDiscovery(udp, stopCh, token, name)
		go s.beaconLoop(udp, stopCh, token, name)
	} else {
		fmt.Printf("[LanSync] UDP 发现端口占用，已仅启用手动连接: %v\n", udpErr)
	}

	return info, nil
}

// StopServer 停止共享（HTTP + UDP）。
func (s *LanSyncService) StopServer() error {
	s.mu.Lock()
	stopCh := s.stopCh
	udp := s.udp
	server := s.server
	s.stopCh = nil
	s.udp = nil
	s.server = nil
	s.listener = nil
	s.payload = nil
	s.info = nil
	s.token = ""
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if udp != nil {
		_ = udp.Close()
	}
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
	return nil
}

// Status 返回当前共享状态；未开启时返回 null。
func (s *LanSyncService) Status() *LanSyncServerInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.info == nil {
		return nil
	}
	copied := *s.info
	copied.Hosts = append([]string(nil), s.info.Hosts...)
	return &copied
}

// Token 返回当前同步令牌（未共享时返回环境变量覆盖值或默认令牌）。
func (s *LanSyncService) Token() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" {
		return s.token
	}
	return normalizeLanSyncToken("")
}

// Discover 在局域网广播探测并收集共享端。
func (s *LanSyncService) Discover(timeoutMs int) ([]LanSyncPeer, error) {
	if timeoutMs <= 0 {
		timeoutMs = 1600
	}
	if timeoutMs < 300 {
		timeoutMs = 300
	}
	if timeoutMs > 5000 {
		timeoutMs = 5000
	}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		return nil, fmt.Errorf("无法创建发现通道：%w", err)
	}
	defer conn.Close()

	targets := lanSyncBroadcastTargets()
	probe := []byte(lanSyncDiscoverMsg)
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	_ = conn.SetReadDeadline(deadline)

	done := make(chan struct{})
	defer close(done)

	sendProbe := func() {
		for _, target := range targets {
			_, _ = conn.WriteToUDP(probe, target)
		}
	}
	sendProbe()
	go func() {
		ticker := time.NewTicker(420 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				sendProbe()
			}
		}
	}()

	peers := map[string]LanSyncPeer{}
	buf := make([]byte, 2048)
	for {
		n, addr, readErr := conn.ReadFromUDP(buf)
		if readErr != nil {
			if errors.Is(readErr, net.ErrClosed) {
				break
			}
			var netErr net.Error
			if errors.As(readErr, &netErr) && netErr.Timeout() {
				break
			}
			continue
		}
		if addr == nil || !isPrivateIP(addr.IP) {
			continue
		}

		var beacon lanSyncBeacon
		if json.Unmarshal(buf[:n], &beacon) != nil {
			continue
		}
		if beacon.Kind != lanSyncBeaconKind || beacon.Port <= 0 {
			continue
		}
		// 兼容：beacon 省略 version 时按 1 处理。
		if beacon.Version != 0 && beacon.Version != lanSyncVersion {
			continue
		}

		host := addr.IP.String()
		port := beacon.Port
		key := net.JoinHostPort(host, strconv.Itoa(port))
		// 配对码不再随广播下发；接收端手动输入。
		token := strings.TrimSpace(beacon.Token)
		name := strings.TrimSpace(beacon.Name)
		if name == "" {
			name = host
		}
		peers[key] = LanSyncPeer{
			Name:    name,
			Host:    host,
			Port:    port,
			Token:   token,
			BaseURL: fmt.Sprintf("http://%s:%d", host, port),
			Version: lanSyncVersion,
		}
	}

	out := make([]LanSyncPeer, 0, len(peers))
	for _, peer := range peers {
		out = append(out, peer)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].Host < out[j].Host
	})
	return out, nil
}

// FetchManifest 从共享端拉清单（用于导入前预览）。
func (s *LanSyncService) FetchManifest(baseURL, token string) (*LanSyncManifest, error) {
	raw, err := s.fetchJSON(baseURL, token, lanSyncHTTPPath)
	if err != nil {
		return nil, err
	}
	var manifest LanSyncManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("清单格式不正确：%w", err)
	}
	if manifest.Kind != "" && manifest.Kind != lanSyncKind {
		return nil, errors.New("对方不是 DTV 同步数据")
	}
	if manifest.Version != 0 && manifest.Version != lanSyncVersion {
		return nil, fmt.Errorf("不支持的同步版本：%d", manifest.Version)
	}
	if manifest.Kind == "" {
		manifest.Kind = lanSyncKind
	}
	if manifest.Version == 0 {
		manifest.Version = lanSyncVersion
	}
	return &manifest, nil
}

// FetchPayload 从共享端拉完整数据。
func (s *LanSyncService) FetchPayload(baseURL, token string) (*LanSyncPayload, error) {
	raw, err := s.fetchJSON(baseURL, token, lanSyncPayloadPath)
	if err != nil {
		return nil, err
	}
	var payload LanSyncPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("同步数据格式不正确：%w", err)
	}
	if err := validateLanSyncPayload(&payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

// ServiceShutdown 在应用退出时停止共享。
func (s *LanSyncService) ServiceShutdown() error {
	return s.StopServer()
}

// ---------------------------------------------------------------- HTTP 服务

func (s *LanSyncService) handleManifest(w http.ResponseWriter, r *http.Request) {
	s.handleSyncRequest(w, r, false)
}

func (s *LanSyncService) handlePayload(w http.ResponseWriter, r *http.Request) {
	s.handleSyncRequest(w, r, true)
}

func (s *LanSyncService) handleSyncRequest(w http.ResponseWriter, r *http.Request, withPayload bool) {
	setLanSyncCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	remoteIP := remoteIPFromRequest(r)
	if remoteIP == nil || !isPrivateIP(remoteIP) {
		http.Error(w, "Forbidden: non-private network.", http.StatusForbidden)
		return
	}
	s.mu.Lock()
	expected := s.token
	payload := s.payload
	s.mu.Unlock()
	if expected == "" || strings.TrimSpace(r.URL.Query().Get("token")) != expected {
		http.Error(w, "Unauthorized.", http.StatusUnauthorized)
		return
	}
	if payload == nil {
		http.Error(w, "sync is not running", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if !withPayload {
		_ = json.NewEncoder(w).Encode(buildLanSyncManifest(payload))
		return
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func setLanSyncCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

func remoteIPFromRequest(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}

// ---------------------------------------------------------------- 发现协议

func (s *LanSyncService) serveDiscovery(conn *net.UDPConn, stopCh <-chan struct{}, token, name string) {
	// 令牌随广播下发：接收端点「一键导入」就能直接连上，不需要手输配对码。
	reply, _ := json.Marshal(lanSyncBeacon{
		Kind:    lanSyncBeaconKind,
		Version: lanSyncVersion,
		Name:    name,
		Port:    lanSyncPort,
		Token:   token,
		Path:    lanSyncHTTPPath,
	})

	buf := make([]byte, 2048)
	for {
		select {
		case <-stopCh:
			return
		default:
		}

		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				continue
			}
			return
		}
		if addr == nil {
			continue
		}
		if strings.TrimSpace(string(buf[:n])) != lanSyncDiscoverMsg {
			continue
		}
		_, _ = conn.WriteToUDP(reply, addr)
	}
}

func (s *LanSyncService) beaconLoop(conn *net.UDPConn, stopCh <-chan struct{}, token, name string) {
	packet, _ := json.Marshal(lanSyncBeacon{
		Kind:    lanSyncBeaconKind,
		Version: lanSyncVersion,
		Name:    name,
		Port:    lanSyncPort,
		Token:   token,
		Path:    lanSyncHTTPPath,
	})
	targets := lanSyncBroadcastTargets()

	// 启动时立刻广播一次，之后每秒一次；接收端只需在弹窗打开时监听。
	send := func() {
		for _, target := range targets {
			_, _ = conn.WriteToUDP(packet, target)
		}
	}
	send()
	ticker := time.NewTicker(1100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			send()
		}
	}
}

// ---------------------------------------------------------------- 本地网络

func lanSyncToken() string {
	return strings.TrimSpace(os.Getenv("DTV_LAN_SYNC_TOKEN"))
}

func normalizeLanSyncToken(raw string) string {
	token := strings.TrimSpace(raw)
	if token == "" {
		if env := lanSyncToken(); env != "" {
			return env
		}
		return lanSyncDefaultToken
	}
	if strings.HasPrefix(token, "token=") {
		if value := strings.TrimSpace(strings.TrimPrefix(token, "token=")); value != "" {
			return value
		}
	}
	return token
}

func validateLanSyncPayload(payload *LanSyncPayload) error {
	if payload == nil {
		return errors.New("同步数据为空")
	}
	if payload.Kind != "" && payload.Kind != lanSyncKind {
		return errors.New("同步数据类型不正确")
	}
	if payload.Version != 0 && payload.Version != lanSyncVersion {
		return fmt.Errorf("不支持的同步版本：%d", payload.Version)
	}
	if payload.Entries == nil {
		payload.Entries = map[string]string{}
	}
	if payload.Kind == "" {
		payload.Kind = lanSyncKind
	}
	if payload.Version == 0 {
		payload.Version = lanSyncVersion
	}
	return nil
}

func buildLanSyncManifest(payload *LanSyncPayload) LanSyncManifest {
	return LanSyncManifest{
		Kind:       payload.Kind,
		Version:    payload.Version,
		ExportedAt: payload.ExportedAt,
		Source:     payload.Source,
		Summary:    buildLanSyncSummary(payload),
	}
}

func buildLanSyncSummary(payload *LanSyncPayload) LanSyncSummary {
	totalBytes := 0
	for key, value := range payload.Entries {
		totalBytes += len(key) + len(value)
	}
	return LanSyncSummary{
		Follows:       firstJSONArrayLength(payload.Entries, "dtv_follows_v1", "followedStreamers"),
		FollowFolders: firstJSONArrayLength(payload.Entries, "dtv_follow_folders_v1", "followFolders"),
		FollowOrder:   firstJSONArrayLength(payload.Entries, "dtv_follow_order_v1", "followListOrder"),
		Subscriptions: firstJSONArrayLength(payload.Entries, "dtv_subscriptions_v1", "dtv_custom_categories_v1"),
		DanmuKeywords: jsonArrayLength(payload.Entries["danmu_block_keywords"]),
		TotalBytes:    totalBytes,
	}
}

func firstJSONArrayLength(entries map[string]string, keys ...string) int {
	for _, key := range keys {
		if raw, ok := entries[key]; ok {
			return jsonArrayLength(raw)
		}
	}
	return 0
}

func jsonArrayLength(raw string) int {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	var list []json.RawMessage
	if json.Unmarshal([]byte(raw), &list) != nil {
		return 0
	}
	return len(list)
}

func lanSyncHosts() []string {
	hosts := []string{"127.0.0.1", "localhost"}
	interfaces, err := net.Interfaces()
	if err != nil {
		return hosts
	}

	var strict []string
	var loose []string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, addrErr := iface.Addrs()
		if addrErr != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() {
				continue
			}
			ipString := ip4.String()
			if isLinkLocalIPv4(ip4) || isBenchmarkIPv4(ip4) {
				continue
			}
			loose = append(loose, ipString)
			if isShareableLanIPv4(ip4) && !isNoiseInterfaceName(iface.Name) {
				strict = append(strict, ipString)
			}
		}
	}

	if len(strict) > 0 {
		hosts = append(hosts, strict...)
	} else {
		hosts = append(hosts, loose...)
	}
	sort.Strings(hosts)
	// 保持 127.0.0.1 在前，其余按字典序去重。
	seen := map[string]struct{}{}
	out := make([]string, 0, len(hosts))
	for _, host := range hosts {
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		out = append(out, host)
	}
	return out
}

func lanSyncBroadcastTargets() []*net.UDPAddr {
	targets := []*net.UDPAddr{{IP: net.IPv4bcast, Port: lanSyncDiscoverNL}}
	seen := map[string]struct{}{"255.255.255.255": {}}

	interfaces, err := net.Interfaces()
	if err != nil {
		return targets
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if isNoiseInterfaceName(iface.Name) {
			continue
		}
		addrs, addrErr := iface.Addrs()
		if addrErr != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipNet.IP.To4()
			mask := ipNet.Mask
			if ip4 == nil || len(mask) != 4 {
				continue
			}
			broadcast := make(net.IP, 4)
			for i := 0; i < 4; i++ {
				broadcast[i] = ip4[i] | ^mask[i]
			}
			key := broadcast.String()
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			targets = append(targets, &net.UDPAddr{IP: broadcast, Port: lanSyncDiscoverNL})
		}
	}
	return targets
}

func firstShareableHost(hosts []string) string {
	for _, host := range hosts {
		ip := net.ParseIP(host)
		if ip == nil {
			continue
		}
		if ip4 := ip.To4(); ip4 != nil && isShareableLanIPv4(ip4) {
			return host
		}
	}
	return "127.0.0.1"
}

func lanSyncDeviceName() string {
	name := strings.TrimSpace(os.Getenv("COMPUTERNAME"))
	if name == "" {
		name = strings.TrimSpace(os.Getenv("HOSTNAME"))
	}
	if name == "" {
		if hostname, err := os.Hostname(); err == nil {
			name = hostname
		}
	}
	if name == "" {
		name = "DTV"
	}
	sanitized := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, name)
	if sanitized == "" {
		sanitized = "DTV"
	}
	return sanitized
}

func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		return ip4.IsLoopback() || ip4.IsPrivate() || isLinkLocalIPv4(ip4)
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func isShareableLanIPv4(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil || ip4.IsLoopback() || isLinkLocalIPv4(ip4) || isBenchmarkIPv4(ip4) {
		return false
	}
	return ip4.IsPrivate() || isCGNATIPv4(ip4)
}

func isLinkLocalIPv4(ip net.IP) bool {
	return len(ip) == 4 && ip[0] == 169 && ip[1] == 254
}

func isBenchmarkIPv4(ip net.IP) bool {
	return len(ip) == 4 && ip[0] == 198 && (ip[1] == 18 || ip[1] == 19)
}

func isCGNATIPv4(ip net.IP) bool {
	return len(ip) == 4 && ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127
}

func isNoiseInterfaceName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	noise := []string{
		"loopback", "internal", "vmware", "vethernet", "virtualbox", "hyper-v",
		"wsl", "docker", "tailscale", "zerotier", "tun", "tap", "vpn", "utun",
	}
	if n == "lo" {
		return true
	}
	for _, token := range noise {
		if strings.Contains(n, token) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- 客户端请求

func (s *LanSyncService) fetchJSON(baseURL, token, path string) ([]byte, error) {
	base, err := normalizeLanSyncBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(base, "/") + path

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, errors.New("共享端地址格式不正确")
	}
	query := u.Query()
	query.Set("token", normalizeLanSyncToken(token))
	u.RawQuery = query.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DTV/4.0 (lan-sync)")

	client := s.client
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接共享端失败：%w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("读取共享端数据失败：%w", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("token 不正确，请确认两端版本一致")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		text := strings.TrimSpace(string(body))
		if text == "" {
			text = resp.Status
		}
		return nil, fmt.Errorf("共享端返回 HTTP %d：%s", resp.StatusCode, text)
	}
	return body, nil
}

func normalizeLanSyncBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("请输入共享端 IP")
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" {
		return "", errors.New("共享端地址格式不正确")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("只支持 http/https 地址")
	}
	// 用户通常只输入 “192.168.1.8”；没有端口时补默认同步端口。
	if u.Port() == "" {
		u.Host = net.JoinHostPort(u.Hostname(), strconv.Itoa(lanSyncPort))
	}
	// 只保留 origin：用户可能粘贴了完整 payload 链接。
	return u.Scheme + "://" + u.Host, nil
}
