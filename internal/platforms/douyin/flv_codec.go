package douyin

// FLV 编码嗅探：只读开头几十 KB 的 FLV tag，拿 video tag 的 CodecID。
//
// 用途：抖音的取流地址支持 codec 查询参数（旧 Tauri 版每次都给 origin 追加
// `&codec=<VCodec>`），但不同房间/边缘节点不一定真按这个参数转码，所以
// 「原画是 H.265 时再给一路 H.264」这件事必须实测，不能凭参数存在就相信。
//
// 注意：**不要用 HEAD 探测**。抖音对 origin 的 HLS 会回 405，按状态码判断会把
// 好的原画误判成坏流；这里用带 Range 的 GET，直接看字节。

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// FLV video tag 的 CodecID（FFmpeg libavformat/flv.h）。
const (
	flvCodecAVC  = 7  // H.264
	flvCodecHEVC = 12 // H.265 / HEVC
)

// flvCodecSniffer 是嗅探入口，抽成变量方便单测注入（真实环境就是 sniffFLVCodec）。
var flvCodecSniffer = sniffFLVCodec

// sniffFLVCodec 取一个 FLV 直播地址，读出首个 video tag 的编码。
// 返回 "h264" / "h265"；拿不到就返回 error。
func sniffFLVCodec(rawURL string) (string, error) {
	if strings.TrimSpace(rawURL) == "" {
		return "", errors.New("空地址")
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", desktopUA)
	req.Header.Set("Referer", urlLiveHome)
	// 只要开头一小段：FLV 头 + 若干 tag 足够覆盖到第一个 video tag
	req.Header.Set("Range", "bytes=0-65535")

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	buf, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", err
	}
	if len(buf) < 13 || string(buf[:3]) != "FLV" {
		return "", errors.New("不是 FLV 流")
	}

	// FLV header 9 字节 + PreviousTagSize0 4 字节
	off := 13
	for off+11 <= len(buf) {
		tagType := buf[off]
		dataSize := int(buf[off+1])<<16 | int(buf[off+2])<<8 | int(buf[off+3])
		dataStart := off + 11
		dataEnd := dataStart + dataSize
		if dataSize <= 0 || dataEnd > len(buf) {
			break
		}
		if tagType == 9 { // video tag
			switch codec := buf[dataStart] & 0x0f; codec { // 低 4 位是 CodecID
			case flvCodecAVC:
				return "h264", nil
			case flvCodecHEVC:
				return "h265", nil
			default:
				return "", fmt.Errorf("未知 CodecID %d", codec)
			}
		}
		off = dataEnd + 4 // 跳过 tag data + PreviousTagSize
	}
	return "", errors.New("前 64KB 里没有 video tag")
}
