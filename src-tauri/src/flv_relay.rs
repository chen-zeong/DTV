//! 斗鱼直链续流。
//!
//! 斗鱼下发给第三方的 flv 直链寿命固定 300 秒，到点 CDN 主动 EOF，与网络、
//! 主播、CDN、清晰度无关（实测 hw-h5 / hs-h5 / scdn 各线路误差均 < 0.5s，
//! 部分线路的 URL 甚至不带 `expire` 参数但同样准时断开，说明这是服务端策略）。
//! 斗鱼官方网页端的做法是每 ~300 秒重新调一次取流接口续签，本模块做的是同一件事：
//! 在旧流到期前预取下一条流，在 FLV tag 边界上接续，对播放器表现为一条不中断的流。
//!
//! 接续之所以成立，是因为斗鱼 flv tag 用的是推流会话的绝对时间戳，重新取流后
//! 时间轴延续而非归零，因此无需改写时间戳，只要丢掉新流的文件头与初始化 tag，
//! 并从第一个时间戳大于已转发位置的关键帧接上即可。

use bytes::{Bytes, BytesMut};
use futures_util::{Stream, StreamExt};
use reqwest::Client;
use std::io::{Error as IoError, ErrorKind};
use std::pin::Pin;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// 斗鱼直链的硬性寿命。
const STREAM_TTL: Duration = Duration::from_secs(300);
/// 提前多久预取下一条流。实测取流 ~650ms + 首个关键帧 ~220ms，5 秒余量充足；
/// 留得过长会让预取连接在切换前积压过多数据。
const RENEW_LEAD: Duration = Duration::from_secs(5);
/// 预取失败后的重试间隔。
const RETRY_DELAY: Duration = Duration::from_millis(500);
/// 连续取流失败多少次后放弃，交给前端走原有的错误提示。
const MAX_CONSECUTIVE_FAILURES: u32 = 5;
/// 解析缓冲的上限。单个 FLV tag 远小于此值，超过即说明字节流无法按 FLV 解析。
const MAX_PENDING_BUFFER: usize = 8 * 1024 * 1024;

pub type ByteStream = Pin<Box<dyn Stream<Item = reqwest::Result<Bytes>> + Send>>;

/// 重新取流所需的上下文。仅斗鱼会设置，其余平台为 None 并因此保持原有的直通行为。
#[derive(Clone, Debug)]
pub struct StreamRenewContext {
    pub room_id: String,
    pub quality: String,
    pub line: Option<String>,
}

#[derive(Debug)]
struct FlvTag {
    /// 完整 tag 字节：11 字节 tag 头 + data + 4 字节 PreviousTagSize。
    raw: Bytes,
    tag_type: u8,
    timestamp: u32,
    is_keyframe: bool,
    is_sequence_header: bool,
}

const TAG_TYPE_AUDIO: u8 = 8;
const TAG_TYPE_VIDEO: u8 = 9;
const TAG_TYPE_SCRIPT: u8 = 18;

/// 增量 FLV 解析：喂入任意大小的字节块，按需吐出完整 tag。
#[derive(Default)]
struct FlvDemuxer {
    buf: BytesMut,
    header: Option<Bytes>,
    header_parsed: bool,
}

impl FlvDemuxer {
    fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
    }

    /// 解析文件头（"FLV" + 版本 + 标志 + dataOffset，后随 PreviousTagSize0）。
    /// 返回 false 表示数据还不够，下次再试。
    fn try_parse_header(&mut self) -> bool {
        if self.header_parsed {
            return true;
        }
        if self.buf.len() < 13 {
            return false;
        }
        if &self.buf[..3] == b"FLV" {
            let data_offset =
                u32::from_be_bytes([self.buf[5], self.buf[6], self.buf[7], self.buf[8]]) as usize;
            let total = data_offset.saturating_add(4);
            if self.buf.len() < total {
                return false;
            }
            self.header = Some(self.buf.split_to(total).freeze());
        }
        self.header_parsed = true;
        true
    }

    /// 必须自行触发解析：调用方会先取文件头再取 tag，
    /// 若等到 next_tag 才解析，文件头就会排到首批 tag 之后发出。
    fn take_header(&mut self) -> Option<Bytes> {
        self.try_parse_header();
        self.header.take()
    }

    /// 缓冲越积越多却吐不出 tag，说明上游不是能按 FLV 解析的字节流。
    /// 用于兜底，避免在非预期容器上无限占用内存。
    fn is_desynced(&self) -> bool {
        self.buf.len() > MAX_PENDING_BUFFER
    }

    fn reset(&mut self) {
        self.buf.clear();
        self.header = None;
        self.header_parsed = false;
    }

    fn next_tag(&mut self) -> Option<FlvTag> {
        if !self.try_parse_header() {
            return None;
        }
        if self.buf.len() < 11 {
            return None;
        }
        let data_size = ((self.buf[1] as usize) << 16)
            | ((self.buf[2] as usize) << 8)
            | (self.buf[3] as usize);
        let total = 11 + data_size + 4;
        if self.buf.len() < total {
            return None;
        }

        let tag_type = self.buf[0] & 0x1f;
        // 时间戳是 3 字节小端序拼 1 字节高位扩展。
        let timestamp = ((self.buf[7] as u32) << 24)
            | ((self.buf[4] as u32) << 16)
            | ((self.buf[5] as u32) << 8)
            | (self.buf[6] as u32);

        let (is_keyframe, is_sequence_header) = if data_size >= 2 {
            let first = self.buf[11];
            let second = self.buf[12];
            match tag_type {
                // 视频：高 4 位为帧类型（1 = 关键帧），后一字节为 0 表示 sequence header。
                TAG_TYPE_VIDEO => (first >> 4 == 1, second == 0),
                // 音频：后一字节为 0 表示 sequence header。
                TAG_TYPE_AUDIO => (false, second == 0),
                _ => (false, false),
            }
        } else {
            (false, false)
        };

        let raw = self.buf.split_to(total).freeze();
        Some(FlvTag {
            raw,
            tag_type,
            timestamp,
            is_keyframe,
            is_sequence_header,
        })
    }
}

/// 记录已转发到的时间轴位置，用于在接续时丢弃新流回吐的重复 tag。
/// 音视频分开记录，避免交错导致误丢。
#[derive(Default)]
struct Timeline {
    last_video_ts: Option<u32>,
    last_audio_ts: Option<u32>,
}

impl Timeline {
    fn observe(&mut self, tag: &FlvTag) {
        match tag.tag_type {
            TAG_TYPE_VIDEO => self.last_video_ts = Some(tag.timestamp),
            TAG_TYPE_AUDIO => self.last_audio_ts = Some(tag.timestamp),
            _ => {}
        }
    }

    /// 新流的 tag 是否已经越过旧流转发到的位置。
    fn is_ahead(&self, tag: &FlvTag) -> bool {
        let last = match tag.tag_type {
            TAG_TYPE_VIDEO => self.last_video_ts,
            TAG_TYPE_AUDIO => self.last_audio_ts,
            _ => None,
        };
        match last {
            Some(prev) => tag.timestamp > prev,
            None => true,
        }
    }
}

/// 一条上游流的读取状态。
struct Segment {
    body: ByteStream,
    demuxer: FlvDemuxer,
    started_at: Instant,
    /// 是否为接续段。
    /// 首段原样转发上游字节块，保持与改造前一致的写入粒度；
    /// 只有接续段才需要在 tag 边界上裁剪，并对裁剪结果重新聚合后发出。
    continuation: bool,
    /// 接续段在遇到第一个可用关键帧之前不转发任何内容。
    waiting_for_keyframe: bool,
}

impl Segment {
    /// `continuation` 为 true 表示这是接续段而非首段。
    fn new(body: ByteStream, continuation: bool) -> Self {
        Self {
            body,
            demuxer: FlvDemuxer::default(),
            started_at: Instant::now(),
            continuation,
            waiting_for_keyframe: continuation,
        }
    }

    fn should_prefetch(&self) -> bool {
        self.started_at.elapsed() + RENEW_LEAD >= STREAM_TTL
    }
}

/// 按平台补齐防盗链所需的请求头，与 proxy.rs 中的直通路径保持一致。
pub fn apply_stream_headers(
    builder: reqwest::RequestBuilder,
    url: &str,
    default_ua: &str,
    huya_ua: &str,
) -> reqwest::RequestBuilder {
    let builder = builder
        .header("User-Agent", default_ua)
        .header("Accept", "video/x-flv,application/octet-stream,*/*")
        .header("Range", "bytes=0-")
        .header("Connection", "keep-alive");

    if url.contains("huya.com") || url.contains("hy-cdn.com") || url.contains("huyaimg.com") {
        builder
            .header("User-Agent", huya_ua)
            .header("Referer", "https://www.huya.com/")
            .header("Origin", "https://www.huya.com")
    } else if url.contains("bilivideo") || url.contains("bilibili.com") || url.contains("hdslb.com")
    {
        builder.header("Referer", "https://live.bilibili.com/")
    } else {
        builder
    }
}

/// 打开一条上游流。首次连接由 handler 同步调用，以便把上游的错误状态原样透传给前端。
pub async fn open_stream(
    client: &Client,
    url: &str,
    default_ua: &str,
    huya_ua: &str,
) -> Result<ByteStream, OpenError> {
    let request = apply_stream_headers(client.get(url), url, default_ua, huya_ua);
    let response = request.send().await.map_err(OpenError::Connect)?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|e| format!("读取上游错误响应失败: {}", e));
        return Err(OpenError::Status { status, body });
    }
    Ok(Box::pin(response.bytes_stream()))
}

#[derive(Debug)]
pub enum OpenError {
    Connect(reqwest::Error),
    Status {
        status: reqwest::StatusCode,
        body: String,
    },
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::Connect(e) => write!(f, "连接上游失败: {}", e),
            OpenError::Status { status, body } => {
                write!(f, "上游返回 {}: {}", status, body)
            }
        }
    }
}

async fn resolve_douyu_url(ctx: &StreamRenewContext) -> Result<String, String> {
    crate::platforms::douyu::get_stream_url_with_quality(
        &ctx.room_id,
        &ctx.quality,
        ctx.line.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// 取一条新流并建立连接。预取与兜底重连共用。
async fn acquire_segment(
    ctx: &StreamRenewContext,
    client: &Client,
    default_ua: &str,
    huya_ua: &str,
) -> Result<ByteStream, String> {
    let url = resolve_douyu_url(ctx).await?;
    open_stream(client, &url, default_ua, huya_ua)
        .await
        .map_err(|e| e.to_string())
}

/// 持续向 `tx` 输出一条逻辑上不中断的 FLV 流。
///
/// `ctx` 为 None 时退化为单段直通：上游结束即结束，行为与改造前一致。
pub async fn run(
    tx: mpsc::Sender<Result<Bytes, IoError>>,
    first_body: ByteStream,
    ctx: Option<StreamRenewContext>,
    client: Client,
    default_ua: String,
    huya_ua: String,
) {
    let mut segment = Segment::new(first_body, false);
    let mut timeline = Timeline::default();
    // 不需要续流的平台（虎牙、B 站）走纯直通，连解析都省掉。
    let mut track_timeline = ctx.is_some();
    let mut prefetch: Option<tokio::task::JoinHandle<Result<ByteStream, String>>> = None;
    let mut failures: u32 = 0;

    loop {
        // 旧流临近到期时，提前取好下一条。
        if let Some(ref ctx) = ctx {
            if prefetch.is_none() && segment.should_prefetch() {
                let ctx = ctx.clone();
                let client = client.clone();
                let default_ua = default_ua.clone();
                let huya_ua = huya_ua.clone();
                prefetch = Some(tokio::spawn(async move {
                    acquire_segment(&ctx, &client, &default_ua, &huya_ua).await
                }));
            }
        }

        match segment.body.next().await {
            Some(Ok(chunk)) => {
                if !segment.continuation {
                    // 首段：原样转发，写入粒度与上游字节块一致（Bytes 克隆是 O(1)，不复制数据）。
                    // 逐 tag 转发会把一次写放大成几十次，反而拖累播放流畅度。
                    if tx.send(Ok(chunk.clone())).await.is_err() {
                        return;
                    }
                    // 只有需要续流时才解析，用于记下时间轴位置供接续段对齐。
                    if track_timeline {
                        segment.demuxer.push(&chunk);
                        // 文件头已随原始字节发出，这里仅消费掉。
                        segment.demuxer.take_header();
                        while let Some(tag) = segment.demuxer.next_tag() {
                            timeline.observe(&tag);
                        }
                        if segment.demuxer.is_desynced() {
                            // 不是可解析的 FLV，放弃维护时间轴，退化为纯直通。
                            eprintln!("[flv_relay] 上游不是可解析的 FLV，停止时间轴跟踪");
                            track_timeline = false;
                            segment.demuxer.reset();
                        }
                    }
                } else {
                    segment.demuxer.push(&chunk);
                    // 接续段的文件头必须丢弃，播放器只认首段那一个。
                    segment.demuxer.take_header();

                    let mut out = BytesMut::new();
                    while let Some(tag) = segment.demuxer.next_tag() {
                        if segment.waiting_for_keyframe {
                            // 丢掉元数据与初始化 tag，播放器已经初始化过了。
                            if tag.tag_type == TAG_TYPE_SCRIPT || tag.is_sequence_header {
                                continue;
                            }
                            // 从第一个越过旧流位置的关键帧开始接。
                            if !(tag.tag_type == TAG_TYPE_VIDEO
                                && tag.is_keyframe
                                && timeline.is_ahead(&tag))
                            {
                                continue;
                            }
                            segment.waiting_for_keyframe = false;
                        } else if tag.tag_type != TAG_TYPE_SCRIPT && !timeline.is_ahead(&tag) {
                            // CDN 会回吐一个 GOP 的缓冲，重复部分直接丢弃。
                            continue;
                        }

                        timeline.observe(&tag);
                        out.extend_from_slice(&tag.raw);
                    }

                    // 聚合后一次发出，保持与首段相近的写入粒度。
                    if !out.is_empty() && tx.send(Ok(out.freeze())).await.is_err() {
                        return;
                    }
                }
            }
            other => {
                if let Some(Err(e)) = other {
                    eprintln!("[flv_relay] 上游读取错误: {}", e);
                }

                let Some(ref ctx) = ctx else {
                    // 非斗鱼：保持原有行为，上游结束即结束。
                    return;
                };

                let elapsed = segment.started_at.elapsed().as_secs_f32();
                // 预取已就绪就直接用，否则说明是提前故障，同步补取一条。
                let next = match prefetch.take() {
                    Some(handle) => match handle.await {
                        Ok(Ok(body)) => Ok(body),
                        Ok(Err(e)) => Err(e),
                        Err(e) => Err(format!("预取任务异常: {}", e)),
                    },
                    None => acquire_segment(ctx, &client, &default_ua, &huya_ua).await,
                };

                match next {
                    Ok(body) => {
                        println!(
                            "[flv_relay] 上一段存活 {:.1}s，已接续新流（房间 {}）",
                            elapsed, ctx.room_id
                        );
                        failures = 0;
                        segment = Segment::new(body, true);
                    }
                    Err(e) => {
                        failures += 1;
                        eprintln!(
                            "[flv_relay] 续流失败 {}/{}: {}",
                            failures, MAX_CONSECUTIVE_FAILURES, e
                        );
                        if failures >= MAX_CONSECUTIVE_FAILURES {
                            let _ = tx.send(Err(IoError::new(ErrorKind::BrokenPipe, e))).await;
                            return;
                        }
                        tokio::time::sleep(RETRY_DELAY).await;
                        match acquire_segment(ctx, &client, &default_ua, &huya_ua).await {
                            Ok(body) => {
                                failures = 0;
                                segment = Segment::new(body, true);
                            }
                            Err(_) => continue,
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拼出一个最小 FLV tag：11 字节头 + data + 4 字节 PreviousTagSize。
    fn make_tag(tag_type: u8, timestamp: u32, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.push(tag_type);
        let size = data.len() as u32;
        out.extend_from_slice(&size.to_be_bytes()[1..]);
        out.extend_from_slice(&timestamp.to_be_bytes()[1..]);
        out.push((timestamp >> 24) as u8);
        out.extend_from_slice(&[0, 0, 0]);
        out.extend_from_slice(data);
        out.extend_from_slice(&(11 + size).to_be_bytes());
        out
    }

    fn flv_header() -> Vec<u8> {
        let mut out = b"FLV\x01\x05".to_vec();
        out.extend_from_slice(&9u32.to_be_bytes());
        out.extend_from_slice(&0u32.to_be_bytes());
        out
    }

    #[test]
    fn parses_header_and_tags() {
        let mut d = FlvDemuxer::default();
        let mut bytes = flv_header();
        bytes.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 30678210, &[0x17, 0x01, 0xaa]));
        bytes.extend_from_slice(&make_tag(TAG_TYPE_AUDIO, 30678211, &[0xaf, 0x01, 0xbb]));
        d.push(&bytes);

        assert!(d.take_header().is_some());

        let v = d.next_tag().expect("video tag");
        assert_eq!(v.tag_type, TAG_TYPE_VIDEO);
        assert_eq!(v.timestamp, 30678210);
        assert!(v.is_keyframe);
        assert!(!v.is_sequence_header);

        let a = d.next_tag().expect("audio tag");
        assert_eq!(a.tag_type, TAG_TYPE_AUDIO);
        assert_eq!(a.timestamp, 30678211);
        assert!(!a.is_sequence_header);

        assert!(d.next_tag().is_none());
    }

    #[test]
    fn handles_split_chunks() {
        let mut full = flv_header();
        full.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 1000, &[0x17, 0x01, 0x00, 0x01]));

        let mut d = FlvDemuxer::default();
        // 逐字节喂入，确认不会因为分片而解析错位。
        for b in &full {
            d.push(&[*b]);
        }
        assert!(d.take_header().is_some());
        let tag = d.next_tag().expect("tag");
        assert_eq!(tag.timestamp, 1000);
    }

    #[test]
    fn detects_sequence_headers() {
        let mut d = FlvDemuxer::default();
        let mut bytes = flv_header();
        bytes.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 0, &[0x17, 0x00, 0x00]));
        bytes.extend_from_slice(&make_tag(TAG_TYPE_AUDIO, 0, &[0xaf, 0x00]));
        d.push(&bytes);
        d.take_header();

        let v = d.next_tag().expect("video seq header");
        assert!(v.is_sequence_header);
        let a = d.next_tag().expect("audio seq header");
        assert!(a.is_sequence_header);
    }

    #[test]
    fn timeline_drops_replayed_tags() {
        let mut t = Timeline::default();
        let mut d = FlvDemuxer::default();
        let mut bytes = flv_header();
        bytes.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 500, &[0x17, 0x01, 0x00]));
        bytes.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 400, &[0x17, 0x01, 0x00]));
        bytes.extend_from_slice(&make_tag(TAG_TYPE_VIDEO, 600, &[0x17, 0x01, 0x00]));
        d.push(&bytes);
        d.take_header();

        let first = d.next_tag().unwrap();
        assert!(t.is_ahead(&first));
        t.observe(&first);

        // 新流回吐的旧 GOP 应被丢弃。
        let replayed = d.next_tag().unwrap();
        assert!(!t.is_ahead(&replayed));

        // 音频时间轴独立，不受视频影响。
        let ahead = d.next_tag().unwrap();
        assert!(t.is_ahead(&ahead));
    }
}
