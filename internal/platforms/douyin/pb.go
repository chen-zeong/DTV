package douyin

import (
	"encoding/binary"
	"fmt"
)

// 这个文件是抖音弹幕协议用到的 protobuf 子集，**手写**而非 protoc 生成。
//
// 原因：抖音的 douyin.proto 有 753 行，但我们真正需要解析的只有
// PushFrame / Response / Message / ChatMessage / User 里寥寥几个字段。
// 手写 wire-format 解析比引入 protoc + 生成代码更轻，也避免生成物进仓库。
//
// 用到的协议字段（均已对照 douyin.proto 确认）：
//
//	PushFrame : seqId=1(varint) logId=2(varint) service=3 method=4
//	            payloadEncoding=6(string) payloadType=7(string) payload=8(bytes)
//	Response  : messagesList=1(repeated Message) cursor=2(string)
//	            internalExt=5(string) needAck=9(bool)
//	Message   : method=1(string) payload=2(bytes) msgId=3(varint)
//	ChatMessage: user=2(message) content=3(string)
//	User      : nickName=3(string) payGrade=23(message) fansClub=24(message)
//	PayGrade  : level=3(varint)
//	FansClub  : data=1(message);  FansClubData: level=2(varint)

// protobuf wire type 常量。
const (
	pbWireVarint  = 0
	pbWireFixed64 = 1
	pbWireBytes   = 2
	pbWireFixed32 = 5
)

// pbField 是一个解析出来的字段。
type pbField struct {
	Num   int
	Wire  int
	Varint uint64
	Bytes  []byte
}

// pbReadFields 顺序扫描一段 protobuf 数据，逐个产出字段。
//
// 只支持本项目需要的 int/string/bytes/message 四种 wire type；
// 遇到 fixed32/fixed64 会跳过（抖音这些消息里不出现）。
func pbReadFields(data []byte) ([]pbField, error) {
	var out []pbField
	i := 0
	for i < len(data) {
		key, n := binary.Uvarint(data[i:])
		if n <= 0 {
			return nil, fmt.Errorf("protobuf: key 解析失败（偏移 %d）", i)
		}
		i += n

		num := int(key >> 3)
		wire := int(key & 0x7)
		if num <= 0 {
			return nil, fmt.Errorf("protobuf: 字段号非法 %d", num)
		}

		field := pbField{Num: num, Wire: wire}
		switch wire {
		case pbWireVarint:
			v, m := binary.Uvarint(data[i:])
			if m <= 0 {
				return nil, fmt.Errorf("protobuf: varint 解析失败（字段 %d）", num)
			}
			i += m
			field.Varint = v
		case pbWireBytes:
			l, m := binary.Uvarint(data[i:])
			if m <= 0 {
				return nil, fmt.Errorf("protobuf: 长度解析失败（字段 %d）", num)
			}
			i += m
			end := i + int(l)
			if end > len(data) {
				return nil, fmt.Errorf("protobuf: 字段 %d 越界（需要 %d，剩余 %d）", num, l, len(data)-i)
			}
			field.Bytes = data[i:end]
			i = end
		case pbWireFixed64:
			i += 8
		case pbWireFixed32:
			i += 4
		default:
			return nil, fmt.Errorf("protobuf: 不支持的 wire type %d（字段 %d）", wire, num)
		}
		out = append(out, field)
	}
	return out, nil
}

// pbFirstBytes 返回第一个指定字段号的 bytes 值。
func pbBytes(fields []pbField, num int) []byte {
	for _, f := range fields {
		if f.Num == num && f.Wire == pbWireBytes {
			return f.Bytes
		}
	}
	return nil
}

// pbString 返回第一个指定字段号的字符串值。
func pbString(fields []pbField, num int) string {
	return string(pbBytes(fields, num))
}

// pbVarint 返回第一个指定字段号的整数值。
func pbVarint(fields []pbField, num int) uint64 {
	for _, f := range fields {
		if f.Num == num && f.Wire == pbWireVarint {
			return f.Varint
		}
	}
	return 0
}

// pbBool 返回第一个指定字段号的布尔值。
func pbBool(fields []pbField, num int) bool { return pbVarint(fields, num) != 0 }

/* ------------------------------------------------------------------ 编码 */

// pbAppendVarint 追加一个 varint 编码。
func pbAppendVarint(buf []byte, v uint64) []byte {
	for v >= 0x80 {
		buf = append(buf, byte(v)|0x80)
		v >>= 7
	}
	return append(buf, byte(v))
}

// pbAppendTag 追加一个字段头。
func pbAppendTag(buf []byte, num, wire int) []byte {
	return pbAppendVarint(buf, uint64(num)<<3|uint64(wire))
}

// pbAppendString 追加一个 string 字段。
func pbAppendString(buf []byte, num int, s string) []byte {
	if s == "" {
		return buf
	}
	buf = pbAppendTag(buf, num, pbWireBytes)
	buf = pbAppendVarint(buf, uint64(len(s)))
	return append(buf, s...)
}

// pbAppendBytes 追加一个 bytes 字段（空值跳过）。
func pbAppendBytes(buf []byte, num int, b []byte) []byte {
	if len(b) == 0 {
		return buf
	}
	buf = pbAppendTag(buf, num, pbWireBytes)
	buf = pbAppendVarint(buf, uint64(len(b)))
	return append(buf, b...)
}

// pbAppendUint 追加一个 varint 字段（0 跳过，与 proto3 默认值语义一致）。
func pbAppendUint(buf []byte, num int, v uint64) []byte {
	if v == 0 {
		return buf
	}
	buf = pbAppendTag(buf, num, pbWireVarint)
	return pbAppendVarint(buf, v)
}

/* ------------------------------------------------------- 弹幕相关结构 */

// pushFrame 是 WS 上的一帧。
type pushFrame struct {
	LogID       uint64
	PayloadType string
	Payload     []byte
}

// encode 把 pushFrame 编码成 protobuf 字节。
func (f pushFrame) encode() []byte {
	var buf []byte
	buf = pbAppendUint(buf, 2, f.LogID)
	buf = pbAppendString(buf, 7, f.PayloadType)
	buf = pbAppendBytes(buf, 8, f.Payload)
	return buf
}

// decodePushFrame 解析一帧。
func decodePushFrame(data []byte) (pushFrame, error) {
	fields, err := pbReadFields(data)
	if err != nil {
		return pushFrame{}, err
	}
	return pushFrame{
		LogID:       pbVarint(fields, 2),
		PayloadType: pbString(fields, 7),
		Payload:     pbBytes(fields, 8),
	}, nil
}

// responseMsg 是 Response 里的一条消息。
type responseMsg struct {
	Method  string
	Payload []byte
}

// response 是解压后的 Response。
type response struct {
	Messages    []responseMsg
	InternalExt string
	NeedAck     bool
}

// decodeResponse 解析 Response。
func decodeResponse(data []byte) (response, error) {
	fields, err := pbReadFields(data)
	if err != nil {
		return response{}, err
	}

	out := response{
		InternalExt: pbString(fields, 5),
		NeedAck:     pbBool(fields, 9),
	}
	for _, f := range fields {
		if f.Num != 1 || f.Wire != pbWireBytes {
			continue
		}
		sub, err := pbReadFields(f.Bytes)
		if err != nil {
			continue // 单条消息坏了不影响其它消息
		}
		out.Messages = append(out.Messages, responseMsg{
			Method:  pbString(sub, 1),
			Payload: pbBytes(sub, 2),
		})
	}
	return out, nil
}

// chatMessage 是我们关心的聊天消息字段。
type chatMessage struct {
	Content     string
	Nickname    string
	UserLevel   int64
	FansClubLv  int64
}

// decodeChatMessage 解析 WebcastChatMessage 的 payload。
func decodeChatMessage(data []byte) (chatMessage, error) {
	fields, err := pbReadFields(data)
	if err != nil {
		return chatMessage{}, err
	}

	out := chatMessage{Content: pbString(fields, 3)}

	// user = 2
	if userBytes := pbBytes(fields, 2); len(userBytes) > 0 {
		userFields, err := pbReadFields(userBytes)
		if err == nil {
			out.Nickname = pbString(userFields, 3)

			// payGrade = 23 → level = 3
			if pg := pbBytes(userFields, 23); len(pg) > 0 {
				if pgFields, err := pbReadFields(pg); err == nil {
					out.UserLevel = int64(pbVarint(pgFields, 3))
				}
			}
			// fansClub = 24 → data = 1 → level = 2
			if fc := pbBytes(userFields, 24); len(fc) > 0 {
				if fcFields, err := pbReadFields(fc); err == nil {
					if d := pbBytes(fcFields, 1); len(d) > 0 {
						if dFields, err := pbReadFields(d); err == nil {
							out.FansClubLv = int64(pbVarint(dFields, 2))
						}
					}
				}
			}
		}
	}

	return out, nil
}
