package services

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// makeFlvTag 拼一个最小 FLV tag：11 字节头 + data + 4 字节 PreviousTagSize。
func makeFlvTag(tagType byte, timestamp uint32, data []byte) []byte {
	out := make([]byte, 0, 11+len(data)+4)
	out = append(out, tagType)
	size := uint32(len(data))
	out = append(out, byte(size>>16), byte(size>>8), byte(size))
	out = append(out, byte(timestamp>>16), byte(timestamp>>8), byte(timestamp))
	out = append(out, byte(timestamp>>24))
	out = append(out, 0, 0, 0) // stream id
	out = append(out, data...)
	out = binary.BigEndian.AppendUint32(out, 11+size)
	return out
}

func flvFileHeader() []byte {
	out := []byte{'F', 'L', 'V', 1, 5}
	out = binary.BigEndian.AppendUint32(out, 9)
	out = binary.BigEndian.AppendUint32(out, 0)
	return out
}

func TestFlvDemuxerParsesHeaderAndTags(t *testing.T) {
	var d flvDemuxer
	payload := flvFileHeader()
	payload = append(payload, makeFlvTag(flvTagVideo, 30678210, []byte{0x17, 0x01, 0xaa})...)
	payload = append(payload, makeFlvTag(flvTagAudio, 30678211, []byte{0xaf, 0x01, 0xbb})...)
	d.push(payload)

	if !d.skipHeader() {
		t.Fatal("文件头应该能解析")
	}

	video, ok := d.nextTag()
	if !ok {
		t.Fatal("应解析出视频 tag")
	}
	if video.typ != flvTagVideo || video.timestamp != 30678210 {
		t.Fatalf("视频 tag 解析错误: typ=%d ts=%d", video.typ, video.timestamp)
	}
	if !video.keyframe || video.sequenceHeader {
		t.Fatalf("关键帧判定错误: keyframe=%v seq=%v", video.keyframe, video.sequenceHeader)
	}

	audio, ok := d.nextTag()
	if !ok {
		t.Fatal("应解析出音频 tag")
	}
	if audio.typ != flvTagAudio || audio.timestamp != 30678211 {
		t.Fatalf("音频 tag 解析错误: typ=%d ts=%d", audio.typ, audio.timestamp)
	}

	if _, ok := d.nextTag(); ok {
		t.Fatal("不应该再解析出 tag")
	}
}

// 逐字节喂入，确认跨字节块分片不会错位。
func TestFlvDemuxerHandlesSplitChunks(t *testing.T) {
	payload := flvFileHeader()
	payload = append(payload, makeFlvTag(flvTagVideo, 1000, []byte{0x17, 0x01, 0x00, 0x01})...)

	var d flvDemuxer
	var tags []flvTag
	for _, b := range payload {
		d.push([]byte{b})
		for {
			tag, ok := d.nextTag()
			if !ok {
				break
			}
			tags = append(tags, tag)
		}
	}
	if len(tags) != 1 {
		t.Fatalf("应解析出 1 个 tag，实际 %d", len(tags))
	}
	if tags[0].timestamp != 1000 {
		t.Fatalf("时间戳错误: %d", tags[0].timestamp)
	}
}

func TestFlvDemuxerDetectsSequenceHeaders(t *testing.T) {
	var d flvDemuxer
	payload := flvFileHeader()
	payload = append(payload, makeFlvTag(flvTagVideo, 0, []byte{0x17, 0x00, 0x00})...)
	payload = append(payload, makeFlvTag(flvTagAudio, 0, []byte{0xaf, 0x00})...)
	d.push(payload)
	d.skipHeader()

	video, ok := d.nextTag()
	if !ok || !video.sequenceHeader {
		t.Fatal("视频 sequence header 未识别")
	}
	audio, ok := d.nextTag()
	if !ok || !audio.sequenceHeader {
		t.Fatal("音频 sequence header 未识别")
	}
}

// 时间戳去重：新流回吐的旧 GOP 必须丢掉，音视频时间轴互相独立。
func TestFlvTimelineDropsReplayedTags(t *testing.T) {
	var d flvDemuxer
	payload := flvFileHeader()
	payload = append(payload, makeFlvTag(flvTagVideo, 500, []byte{0x17, 0x01, 0x00})...)
	payload = append(payload, makeFlvTag(flvTagVideo, 400, []byte{0x17, 0x01, 0x00})...)
	payload = append(payload, makeFlvTag(flvTagAudio, 10, []byte{0xaf, 0x01})...)
	d.push(payload)
	d.skipHeader()

	var timeline flvTimeline
	first, _ := d.nextTag()
	if !timeline.isAhead(first) {
		t.Fatal("第一条应该通过")
	}
	timeline.observe(first)

	replayed, _ := d.nextTag()
	if timeline.isAhead(replayed) {
		t.Fatal("回吐的旧 tag 应该被丢弃")
	}

	// 音频时间轴独立：视频已经到 500ms，但音频只有 10ms，仍应通过。
	audio, _ := d.nextTag()
	if !timeline.isAhead(audio) {
		t.Fatal("音频时间轴不应受视频影响")
	}
}

// 接续段：丢弃文件头 / 元数据 / sequence header，从越过旧位置的关键帧开始。
func TestForwardSegmentContinuation(t *testing.T) {
	var timeline flvTimeline
	timeline.observe(flvTag{typ: flvTagVideo, timestamp: 1000})

	var first bytes.Buffer
	first.WriteString("first")

	track := true
	segment := newFlvSegment(nil, true)
	var sink bytes.Buffer

	payload := flvFileHeader()
	payload = append(payload, makeFlvTag(flvTagScript, 0, []byte{0x02, 0x00})...)
	payload = append(payload, makeFlvTag(flvTagVideo, 0, []byte{0x17, 0x00, 0x00})...)    // sequence header
	payload = append(payload, makeFlvTag(flvTagVideo, 900, []byte{0x17, 0x01, 0x00})...)  // 旧 GOP
	payload = append(payload, makeFlvTag(flvTagVideo, 1500, []byte{0x27, 0x01, 0x00})...) // 非关键帧
	payload = append(payload, makeFlvTag(flvTagVideo, 1600, []byte{0x17, 0x01, 0x00})...) // 关键帧，应从这里接
	payload = append(payload, makeFlvTag(flvTagVideo, 1700, []byte{0x17, 0x01, 0x00})...) // 正常继续

	if err := forwardSegment(
		flvSink{w: &sink},
		segment,
		payload,
		&timeline,
		&track,
		nil,
	); err != nil {
		t.Fatalf("转发失败: %v", err)
	}

	if segment.waitingKeyframe {
		t.Fatal("遇到关键帧后应结束等待")
	}
	if sink.Len() == 0 {
		t.Fatal("应该输出接续后的 tag")
	}
	// 输出里不应包含接续段的文件头
	if bytes.Contains(sink.Bytes(), []byte("FLV")) {
		t.Fatal("接续段不应转发文件头")
	}
	if timeline.lastVideoTs != 1700 {
		t.Fatalf("时间轴应推进到 1700，实际 %d", timeline.lastVideoTs)
	}
	if first.Len() != 5 {
		t.Fatalf("首段辅助缓冲不应被改动，实际 %q", first.String())
	}
}

// makeAVCTag 拼一个 AVCPacketType=1 的视频 tag，data 里带 3 字节 CTS。
func makeAVCTag(timestamp uint32, cts int32, keyframe bool) []byte {
	frame := byte(0x27)
	if keyframe {
		frame = 0x17
	}
	raw := int32(cts)
	data := []byte{frame, 0x01, byte(raw >> 16), byte(raw >> 8), byte(raw)}
	return makeFlvTag(flvTagVideo, timestamp, data)
}

func parseFlvTags(t *testing.T, payload []byte) []flvTag {
	t.Helper()
	var d flvDemuxer
	d.push(payload)
	if !d.skipHeader() {
		t.Fatal("输出应包含 FLV 文件头")
	}
	var tags []flvTag
	for {
		tag, ok := d.nextTag()
		if !ok {
			break
		}
		tags = append(tags, tag)
	}
	return tags
}

// 直播伴侣 / 手机开播：视频 PTS 因 B 帧重排晚 80ms，音频整体后移对齐。
func TestFlvAVNormalizerShiftsAudioToVideoPTS(t *testing.T) {
	payload := flvFileHeader()
	payload = append(payload, makeAVCTag(1000, 80, true)...)
	payload = append(payload, makeFlvTag(flvTagAudio, 1000, []byte{0xaf, 0x01, 0x00})...)

	normalizer := &flvAVNormalizer{}
	timeline := &flvTimeline{}
	track := true
	segment := newFlvSegment(nil, false)
	var sink bytes.Buffer
	if err := forwardSegment(
		flvSink{w: &sink},
		segment,
		payload,
		timeline,
		&track,
		normalizer,
	); err != nil {
		t.Fatalf("转发失败: %v", err)
	}

	tags := parseFlvTags(t, sink.Bytes())
	if len(tags) != 2 {
		t.Fatalf("应输出 2 个 tag，实际 %d", len(tags))
	}
	if tags[0].typ != flvTagVideo || tags[0].timestamp != 1000 {
		t.Fatalf("视频 tag 不应被改：typ=%d ts=%d", tags[0].typ, tags[0].timestamp)
	}
	if tags[1].typ != flvTagAudio || tags[1].timestamp != 1080 {
		t.Fatalf("音频应后移 80ms 到 1080，实际 %d", tags[1].timestamp)
	}
}

// OBS 这类已经对齐的流（差值 < 40ms）不能被动过。
func TestFlvAVNormalizerLeavesAlignedStreamAlone(t *testing.T) {
	payload := flvFileHeader()
	payload = append(payload, makeAVCTag(1000, 20, true)...)
	payload = append(payload, makeFlvTag(flvTagAudio, 1000, []byte{0xaf, 0x01, 0x00})...)

	normalizer := &flvAVNormalizer{}
	timeline := &flvTimeline{}
	track := true
	segment := newFlvSegment(nil, false)
	var sink bytes.Buffer
	if err := forwardSegment(
		flvSink{w: &sink},
		segment,
		payload,
		timeline,
		&track,
		normalizer,
	); err != nil {
		t.Fatalf("转发失败: %v", err)
	}

	tags := parseFlvTags(t, sink.Bytes())
	if tags[1].timestamp != 1000 {
		t.Fatalf("20ms 差值不应补偿，音频 ts=%d", tags[1].timestamp)
	}
}
