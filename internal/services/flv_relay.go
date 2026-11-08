package services

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"time"
)

// flv_relay.go 是 PR #154（DTV 上游）"斗鱼直链续流"的 Go 移植。
//
// 为什么需要它：斗鱼下发给第三方的 flv 直链寿命固定 300 秒，到点 CDN 主动
// EOF（实测各线路误差 < 1s，部分线路的 URL 甚至不带 expire 参数但同样准时断
// 开，说明是服务端策略）。官方网页端的做法是每 ~300 秒重新调一次取流接口续签；
// 这里做同一件事：旧流到期前预取下一条，在 FLV tag 边界上接续，对播放器表现为
// 一条不中断的流。
//
// 接续能成立的前提（PR 里都做了实测）：
//  1. 旧流存活期内可以再建一条连接，新流从自己建连时开始重新计时；
//  2. 斗鱼 flv tag 用的是推流会话的绝对时间戳，重新取流后时间轴延续而非归零，
//     所以不需要改写时间戳；
//  3. 因此只需要丢掉新流的文件头、onMetaData 与两个 sequence header，再从第一个
//     时间戳越过"已转发位置"的关键帧接上即可；CDN 会回吐约一个 GOP，按时间戳去重。

const (
	// flvStreamTTL 是斗鱼直链的硬性寿命。
	flvStreamTTL = 300 * time.Second
	// flvRenewLead 是提前多久预取下一条流。实测取流 ~650ms + 首个关键帧 ~220ms，
	// 5 秒余量充足；留得过长会让预取连接在切换前积压过多数据。
	flvRenewLead = 5 * time.Second
	// flvRetryDelay 是续流失败后的重试间隔。
	flvRetryDelay = 500 * time.Millisecond
	// flvMaxFailures 是连续取流失败多少次后放弃（交给前端走原有错误提示）。
	flvMaxFailures = 5
	// flvMaxPending 是解析缓冲上限。单个 FLV tag 远小于此值，超过即说明字节流
	// 无法按 FLV 解析，此时退化为纯直通而不是无限占用内存。
	flvMaxPending = 8 << 20
	// flvReadBuffer 是一次读取上游的块大小。
	flvReadBuffer = 32 * 1024

	// 音画同步补偿：直播伴侣 / 手机开播的 NVENC 流，视频 tag 的 DTS 没有
	// 为 B 帧重排提前，PTS=DTS+CTS 会比音频晚 60~100ms（OBS 一般会补偿）。
	// 首段同时拿到首个音频与首个视频 tag 后，若两者相差在这个区间内，
	// 就把所有音频 tag 的时间戳平移相同差值，让 PTS 与音频对齐。
	flvAVSyncThresholdMS = 40
	flvAVSyncMaxShiftMS  = 500
	// 首段还没凑齐音视频 tag 时的缓冲上限；超过就放弃补偿并原样转发。
	flvAVSyncPendingMax = 1 << 20
)

const (
	flvTagAudio  = 8
	flvTagVideo  = 9
	flvTagScript = 18
)

// flvTag 是一个完整 tag：11 字节 tag 头 + data + 4 字节 PreviousTagSize。
type flvTag struct {
	raw       []byte
	typ       byte
	timestamp uint32
	// pts 只对视频有意义：timestamp 是 DTS，pts = DTS + composition time offset。
	pts            int64
	keyframe       bool
	sequenceHeader bool
}

// flvDemuxer 增量解析 FLV：先吃文件头，再按 tag 吐。
type flvDemuxer struct {
	buf        []byte
	headerDone bool
	// header 保留原始 FLV 文件头，供“需要重写 tag”的路径先写出文件头。
	header []byte
}

func (d *flvDemuxer) push(chunk []byte) {
	d.buf = append(d.buf, chunk...)
}

func (d *flvDemuxer) pending() int { return len(d.buf) }

func (d *flvDemuxer) reset() {
	d.buf = nil
	d.header = nil
	d.headerDone = false
}

// skipHeader 丢掉 FLV 文件头（"FLV" + 版本 + 标志 + dataOffset + PreviousTagSize0）。
//
// 不是以 "FLV" 开头时按"没有文件头"处理，直接把缓冲当成 tag 流，
// 避免非预期容器上一直等不到解析。
func (d *flvDemuxer) skipHeader() bool {
	if d.headerDone {
		return true
	}
	if len(d.buf) < 9 {
		return false
	}
	total := 0
	if string(d.buf[:3]) == "FLV" {
		offset := int(binary.BigEndian.Uint32(d.buf[5:9]))
		if offset < 9 {
			offset = 9
		}
		total = offset + 4
		if len(d.buf) < total {
			return false
		}
	}
	d.header = append([]byte(nil), d.buf[:total]...)
	d.buf = d.buf[total:]
	d.headerDone = true
	return true
}

// nextTag 取出下一个完整 tag；数据不够时返回 false（等下次 push）。
func (d *flvDemuxer) nextTag() (flvTag, bool) {
	if !d.skipHeader() {
		return flvTag{}, false
	}
	if len(d.buf) < 11 {
		return flvTag{}, false
	}
	size := int(d.buf[1])<<16 | int(d.buf[2])<<8 | int(d.buf[3])
	total := 11 + size + 4
	if len(d.buf) < total {
		return flvTag{}, false
	}

	typ := d.buf[0] & 0x1f
	// 时间戳是 3 字节（低 24 位，位置 4..6）+ 1 字节高位扩展（位置 7）。
	ts := uint32(d.buf[7])<<24 |
		uint32(d.buf[4])<<16 |
		uint32(d.buf[5])<<8 |
		uint32(d.buf[6])

	var keyframe, seq bool
	var cts int32
	if size >= 2 {
		first, second := d.buf[11], d.buf[12]
		switch typ {
		case flvTagVideo:
			// 视频：高 4 位是帧类型（1 = 关键帧），后一字节为 0 表示 sequence header。
			keyframe = first>>4 == 1
			seq = second == 0
			// AVCPacketType=1 时，紧跟的 3 字节是有符号的 composition time offset。
			if second == 1 && size >= 5 {
				raw := int32(d.buf[13])<<16 | int32(d.buf[14])<<8 | int32(d.buf[15])
				if raw&0x800000 != 0 {
					raw |= ^int32(0xFFFFFF)
				}
				cts = raw
			}
		case flvTagAudio:
			// 音频：后一字节为 0 表示 sequence header。
			seq = second == 0
		}
	}

	tag := flvTag{
		raw:            d.buf[:total],
		typ:            typ,
		timestamp:      ts,
		pts:            int64(ts) + int64(cts),
		keyframe:       keyframe,
		sequenceHeader: seq,
	}
	d.buf = d.buf[total:]
	if len(d.buf) == 0 {
		// 让已消费的前缀及时被回收，长时间播放时内存只跟单次读取量有关。
		d.buf = nil
	}
	return tag, true
}

// flvTimeline 记录已转发到的时间轴位置，用于接续时丢弃新流回吐的重复 tag。
// 音视频分开记录，避免交错导致误丢。
type flvTimeline struct {
	lastVideoTs uint32
	hasVideo    bool
	lastAudioTs uint32
	hasAudio    bool
}

func (t *flvTimeline) observe(tag flvTag) {
	switch tag.typ {
	case flvTagVideo:
		t.lastVideoTs, t.hasVideo = tag.timestamp, true
	case flvTagAudio:
		t.lastAudioTs, t.hasAudio = tag.timestamp, true
	}
}

// isAhead 判断新流的 tag 是否已经越过旧流转发到的位置。
func (t *flvTimeline) isAhead(tag flvTag) bool {
	switch tag.typ {
	case flvTagVideo:
		if !t.hasVideo {
			return true
		}
		return tag.timestamp > t.lastVideoTs
	case flvTagAudio:
		if !t.hasAudio {
			return true
		}
		return tag.timestamp > t.lastAudioTs
	default:
		return true
	}
}

// flvAVNormalizer 负责给“视频 PTS 被 B 帧重排推迟、音频没补偿”的流做一次
// 固定偏移补偿。
//
// 为什么只补音频：FLV 视频 tag 的 timestamp 是 DTS，播放器用 DTS+CTS 得到 PTS；
// 直播伴侣 / 手机开播的编码器常常把 DTS 当采集时间、CTS 只表示重排延迟，
// 于是视频 PTS 天然比音频晚 ~60–100ms。把音频时间戳整体后移同样的差值，
// 就能让“首帧音频”和“首帧视频 PTS”落在同一时刻。OBS 的流通常已经补偿过，
// 首帧差值很小，不会触发。
type flvAVNormalizer struct {
	decided       bool
	shiftMS       int64
	hasAudio      bool
	firstAudioTS  int64
	hasVideo      bool
	firstVideoPTS int64
	pending       []flvTag
	pendingBytes  int
}

// observe 记录首帧；返回 true 表示“刚好在这个 tag 上完成决策”。
func (n *flvAVNormalizer) observe(tag flvTag) bool {
	if tag.sequenceHeader || tag.typ == flvTagScript {
		return false
	}
	switch tag.typ {
	case flvTagAudio:
		if !n.hasAudio {
			n.firstAudioTS = int64(tag.timestamp)
			n.hasAudio = true
		}
	case flvTagVideo:
		if !n.hasVideo {
			n.firstVideoPTS = tag.pts
			n.hasVideo = true
		}
	}
	if n.decided || !n.hasAudio || !n.hasVideo {
		return false
	}
	n.decided = true
	delta := n.firstVideoPTS - n.firstAudioTS
	if delta >= flvAVSyncThresholdMS && delta <= flvAVSyncMaxShiftMS {
		n.shiftMS = delta
	} else if delta <= -flvAVSyncThresholdMS && delta >= -flvAVSyncMaxShiftMS {
		n.shiftMS = delta
	}
	return true
}

// forceDecide 在迟迟凑不齐音视频（或缓冲过大）时放弃补偿并原样输出。
func (n *flvAVNormalizer) forceDecide() {
	if !n.decided {
		n.decided = true
		n.shiftMS = 0
	}
}

// apply 把补偿值写到音频 tag 的时间戳上（原地改 raw 的 4 个 timestamp 字节）。
func (n *flvAVNormalizer) apply(tag *flvTag) {
	if !n.decided || n.shiftMS == 0 || tag.typ != flvTagAudio || tag.sequenceHeader {
		return
	}
	n.writeTimestamp(tag, int64(tag.timestamp)+n.shiftMS, 0)
}

func (n *flvAVNormalizer) writeTimestamp(tag *flvTag, ts, cts int64) {
	if ts < 0 {
		ts = 0
	}
	if ts > int64(^uint32(0)) {
		ts = int64(^uint32(0))
	}
	tag.timestamp = uint32(ts)
	tag.pts = ts + cts
	if len(tag.raw) >= 8 {
		// FLV 低 24 位时间戳在 tag 头 4..6 字节里是大端；第 7 字节是高 8 位。
		tag.raw[4] = byte(ts >> 16)
		tag.raw[5] = byte(ts >> 8)
		tag.raw[6] = byte(ts)
		tag.raw[7] = byte(ts >> 24)
	}
}

// flvSegment 是一条上游流的读取状态。
type flvSegment struct {
	body    io.ReadCloser
	demux   flvDemuxer
	started time.Time
	// continuation 表示这是接续段：需要按 tag 裁剪并重新聚合后写出。
	// 首段原样转发上游字节块，保持与改造前一致的写入粒度。
	continuation bool
	// waitingKeyframe 表示接续段在遇到第一个可用关键帧之前不转发任何内容。
	waitingKeyframe bool
	// headerWritten 表示首段文件头已经写出（音画补偿路径需要自己写文件头）。
	headerWritten bool
}

func newFlvSegment(body io.ReadCloser, continuation bool) *flvSegment {
	return &flvSegment{
		body:            body,
		started:         time.Now(),
		continuation:    continuation,
		waitingKeyframe: continuation,
	}
}

func (s *flvSegment) shouldPrefetch() bool {
	return time.Since(s.started)+flvRenewLead >= flvStreamTTL
}

// flvSink 是续流的输出侧（HTTP 响应体 + flush）。
type flvSink struct {
	w     io.Writer
	flush func()
}

func (s flvSink) write(chunk []byte) error {
	if len(chunk) == 0 {
		return nil
	}
	if _, err := s.w.Write(chunk); err != nil {
		return err
	}
	if s.flush != nil {
		s.flush()
	}
	return nil
}

// upstreamOpener 取一条新的上游流。首段与续流共用。
type upstreamOpener func(ctx context.Context) (io.ReadCloser, error)

type prefetchResult struct {
	body io.ReadCloser
	err  error
}

// relayFlv 持续向 sink 输出一条逻辑上不中断的 FLV 流。
//
// renew 为 false 时退化为单段直通：上游结束即结束（虎牙 / B 站等不需要续流的平台）。
func relayFlv(
	ctx context.Context,
	sink flvSink,
	first io.ReadCloser,
	open upstreamOpener,
	renew bool,
	syncAV bool,
	onSwitch func(elapsed time.Duration, err error),
) {
	segment := newFlvSegment(first, false)
	timeline := &flvTimeline{}
	// 不需要续流的平台连解析都省掉。
	trackTimeline := renew
	var normalizer *flvAVNormalizer
	if syncAV {
		normalizer = &flvAVNormalizer{}
		trackTimeline = true
	}

	var prefetch chan prefetchResult
	var failures int
	buf := make([]byte, flvReadBuffer)

	startPrefetch := func() {
		ch := make(chan prefetchResult, 1)
		prefetch = ch
		go func() {
			body, err := open(ctx)
			ch <- prefetchResult{body: body, err: err}
		}()
	}

	takePrefetched := func() (io.ReadCloser, error) {
		if prefetch == nil {
			return open(ctx)
		}
		result := <-prefetch
		prefetch = nil
		return result.body, result.err
	}

	for {
		if renew && prefetch == nil && segment.shouldPrefetch() {
			startPrefetch()
		}

		n, readErr := segment.body.Read(buf)
		if n > 0 {
			if err := forwardSegment(sink, segment, buf[:n], timeline, &trackTimeline, normalizer); err != nil {
				_ = segment.body.Close()
				return
			}
		}
		if readErr == nil {
			continue
		}

		// 上游结束（正常到期 EOF 或 CDN 故障）。
		_ = segment.body.Close()
		elapsed := time.Since(segment.started)

		if !renew {
			// 非续流平台：保持原有行为，上游结束即结束。
			return
		}
		if ctx.Err() != nil {
			return
		}

		next, nextErr := takePrefetched()
		if nextErr == nil {
			failures = 0
			if onSwitch != nil {
				onSwitch(elapsed, nil)
			}
			segment = newFlvSegment(next, true)
			continue
		}

		failures++
		if onSwitch != nil {
			onSwitch(elapsed, nextErr)
		}
		if failures >= flvMaxFailures || errors.Is(nextErr, context.Canceled) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(flvRetryDelay):
		}
		// 预取失败时同步再取一次，避免把 300 秒的窗口白白耗掉。
		if body, err := open(ctx); err == nil {
			failures = 0
			segment = newFlvSegment(body, true)
		}
	}
}

// forwardSegment 把一段上游字节转发到 sink。
//
// 首段：原样转发（写入粒度与上游一致），只在需要续流时旁路解析维护时间轴。
// 接续段：按 tag 裁剪、去重、聚合后一次写出。
//
// normalizer 非空时首段改为“解析 tag → 音画补偿 → 重新写出”，
// 接续段也复用同一个补偿值，保证 300 秒续流前后时间轴一致。
func forwardSegment(
	sink flvSink,
	segment *flvSegment,
	chunk []byte,
	timeline *flvTimeline,
	trackTimeline *bool,
	normalizer *flvAVNormalizer,
) error {
	if !segment.continuation {
		if normalizer == nil {
			if err := sink.write(chunk); err != nil {
				return err
			}
			if !*trackTimeline {
				return nil
			}
			segment.demux.push(chunk)
			// 文件头已经随原始字节发出去了，这里只是消费掉。
			segment.demux.skipHeader()
			for {
				tag, ok := segment.demux.nextTag()
				if !ok {
					break
				}
				timeline.observe(tag)
			}
			if segment.demux.pending() > flvMaxPending {
				// 不是可解析的 FLV：放弃维护时间轴，退化为纯直通。
				*trackTimeline = false
				segment.demux.reset()
			}
			return nil
		}
		return forwardFirstSegmentNormalized(sink, segment, chunk, timeline, normalizer)
	}

	segment.demux.push(chunk)
	// 接续段的文件头必须丢弃，播放器只认首段那一个。
	segment.demux.skipHeader()

	var out []byte
	for {
		tag, ok := segment.demux.nextTag()
		if !ok {
			break
		}
		if normalizer != nil {
			// 接续段的音频也要用首段算出的同一个偏移，否则 300 秒一过又错开。
			normalizer.apply(&tag)
		}
		if segment.waitingKeyframe {
			// 丢掉元数据与初始化 tag，播放器已经初始化过了。
			if tag.typ == flvTagScript || tag.sequenceHeader {
				continue
			}
			// 从第一个越过旧流位置的关键帧开始接。
			if !(tag.typ == flvTagVideo && tag.keyframe && timeline.isAhead(tag)) {
				continue
			}
			segment.waitingKeyframe = false
		} else if tag.typ != flvTagScript && !timeline.isAhead(tag) {
			// CDN 会回吐一个 GOP 的缓冲，重复部分直接丢弃。
			continue
		}
		timeline.observe(tag)
		out = append(out, tag.raw...)
	}
	if segment.demux.pending() > flvMaxPending {
		segment.demux.reset()
	}
	return sink.write(out)
}

// forwardFirstSegmentNormalized 处理首段的音画补偿路径。
//
// 首段不能再“原样转发”：必须先把 tag 解析出来，等首个音频和首个视频都出现，
// 才能算出音频需要平移多少。在此之前先把 tag 缓存在 pending 里。
func forwardFirstSegmentNormalized(
	sink flvSink,
	segment *flvSegment,
	chunk []byte,
	timeline *flvTimeline,
	normalizer *flvAVNormalizer,
) error {
	segment.demux.push(chunk)

	if !segment.demux.headerDone {
		if !segment.demux.skipHeader() {
			// 文件头还没收全，等下一次读取。
			return nil
		}
	}
	if !segment.headerWritten {
		segment.headerWritten = true
		if len(segment.demux.header) > 0 {
			if err := sink.write(segment.demux.header); err != nil {
				return err
			}
		}
	}

	var out []byte
	for {
		tag, ok := segment.demux.nextTag()
		if !ok {
			break
		}

		if !normalizer.decided {
			normalizer.pending = append(normalizer.pending, tag)
			normalizer.pendingBytes += len(tag.raw)
			if normalizer.observe(tag) {
				flushAVPending(normalizer, timeline, &out)
				continue
			}
			if normalizer.pendingBytes > flvAVSyncPendingMax {
				// 音视频一直凑不齐（例如纯音频流）：放弃补偿，先转发已有 tag。
				normalizer.forceDecide()
				flushAVPending(normalizer, timeline, &out)
			}
			continue
		}

		normalizer.apply(&tag)
		timeline.observe(tag)
		out = append(out, tag.raw...)
	}

	if segment.demux.pending() > flvMaxPending {
		// 无法继续按 FLV 解析：保留已解析的输出，丢掉解析缓冲。
		segment.demux.reset()
	}
	return sink.write(out)
}

// flushAVPending 把缓存中的首段 tag 应用补偿后写出。
func flushAVPending(normalizer *flvAVNormalizer, timeline *flvTimeline, out *[]byte) {
	for _, tag := range normalizer.pending {
		normalizer.apply(&tag)
		timeline.observe(tag)
		*out = append(*out, tag.raw...)
	}
	normalizer.pending = nil
	normalizer.pendingBytes = 0
}
