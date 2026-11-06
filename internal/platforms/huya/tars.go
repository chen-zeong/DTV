package huya

import (
	"fmt"
)

// 本文件是虎牙取流/弹幕都依赖的 TARS(JCE) 编解码子集。
//
// 实现严格对齐旧项目用的 tars-stream 0.1.1 crate（已核对源码）：
//
//	类型编号: 0 int8, 1 int16, 2 int32, 3 int64, 4 float, 5 double,
//	          6 string1(1字节长度), 7 string4(4字节长度), 8 map, 9 list,
//	          10 struct 开始, 11 struct 结束, 12 zero, 13 字节数组
//	头部:     tag<15 → (tag<<4)|type 一个字节；否则 (0xF0|type) + tag 字节
//	整数压缩: 能塞进更小的类型就用更小的（0 直接用 EnZero，不写数据）
//	字节数组: head(EnSimplelist) + head(0, EnInt8) + int32(0, 长度) + 数据
//	map/list: head + int32(0, 元素个数) + 逐项（键 tag0 / 值 tag1，元素 tag0）
//
// 注意：这套编号与常见文档里的 JCE 编号（10=BYTE_ARRAY）不同，
// 这里以实际 crate 为准，否则服务器不认。

const (
	tInt8      = 0
	tInt16     = 1
	tInt32     = 2
	tInt64     = 3
	tFloat     = 4
	tDouble    = 5
	tString1   = 6
	tString4   = 7
	tMaps      = 8
	tList      = 9
	tStructBeg = 10
	tStructEnd = 11
	tZero      = 12
	tSimple    = 13
)

/* ------------------------------------------------------------------ 编码 */

type tarsWriter struct {
	buf []byte
}

func newTarsWriter() *tarsWriter { return &tarsWriter{} }

func (w *tarsWriter) bytes() []byte { return w.buf }

func (w *tarsWriter) putHead(tag uint8, typ uint8) {
	if tag < 15 {
		w.buf = append(w.buf, byte(tag<<4)|typ)
	} else {
		w.buf = append(w.buf, 0xF0|typ)
		w.buf = append(w.buf, tag)
	}
}

func (w *tarsWriter) writeInt8(tag uint8, v int8) {
	if v == 0 {
		w.putHead(tag, tZero)
		return
	}
	w.putHead(tag, tInt8)
	w.buf = append(w.buf, byte(v))
}

func (w *tarsWriter) writeInt16(tag uint8, v int16) {
	if v >= -128 && v <= 127 {
		w.writeInt8(tag, int8(v))
		return
	}
	w.putHead(tag, tInt16)
	w.buf = append(w.buf, byte(v>>8), byte(v))
}

func (w *tarsWriter) writeInt32(tag uint8, v int32) {
	if v >= -32768 && v <= 32767 {
		w.writeInt16(tag, int16(v))
		return
	}
	w.putHead(tag, tInt32)
	w.buf = append(w.buf, byte(v>>24), byte(v>>16), byte(v>>8), byte(v))
}

func (w *tarsWriter) writeInt64(tag uint8, v int64) {
	if v >= -2147483648 && v <= 2147483647 {
		w.writeInt32(tag, int32(v))
		return
	}
	w.putHead(tag, tInt64)
	w.buf = append(w.buf, byte(v>>56), byte(v>>48), byte(v>>40), byte(v>>32),
		byte(v>>24), byte(v>>16), byte(v>>8), byte(v))
}

func (w *tarsWriter) writeString(tag uint8, s string) {
	if len(s) <= 255 {
		w.putHead(tag, tString1)
		w.buf = append(w.buf, byte(len(s)))
		w.buf = append(w.buf, s...)
		return
	}
	w.putHead(tag, tString4)
	w.buf = append(w.buf, byte(len(s)>>24), byte(len(s)>>16), byte(len(s)>>8), byte(len(s)))
	w.buf = append(w.buf, s...)
}

func (w *tarsWriter) writeBytes(tag uint8, data []byte) {
	w.putHead(tag, tSimple)
	w.putHead(0, tInt8)
	w.writeInt32(0, int32(len(data)))
	w.buf = append(w.buf, data...)
}

func (w *tarsWriter) writeStringList(tag uint8, list []string) {
	w.putHead(tag, tList)
	w.writeInt32(0, int32(len(list)))
	for _, item := range list {
		w.writeString(0, item)
	}
}

func (w *tarsWriter) writeStringMap(tag uint8, m map[string]string) {
	w.putHead(tag, tMaps)
	w.writeInt32(0, int32(len(m)))
	for k, v := range m {
		w.writeString(0, k)
		w.writeString(1, v)
	}
}

func (w *tarsWriter) writeEmptyMap(tag uint8) {
	w.putHead(tag, tMaps)
	w.writeInt32(0, 0)
}

func (w *tarsWriter) writeBytesMap(tag uint8, k string, v []byte) {
	w.putHead(tag, tMaps)
	w.writeInt32(0, 1)
	w.writeString(0, k)
	w.writeBytes(1, v)
}

func (w *tarsWriter) writeStructBegin(tag uint8) { w.putHead(tag, tStructBeg) }
func (w *tarsWriter) writeStructEnd()            { w.putHead(0, tStructEnd) }

/* ------------------------------------------------------------------ 解码 */

type tarsReader struct {
	buf  []byte
	pos  int
	// lastSize 记录最近一次整数读取的值，供 skipField 在跳过字节数组时复用长度
	lastSize int
}

func newTarsReader(buf []byte) *tarsReader { return &tarsReader{buf: buf} }

type tarsHead struct {
	tag uint8
	typ uint8
}

func (r *tarsReader) takeHead() (tarsHead, error) {
	if r.pos >= len(r.buf) {
		return tarsHead{}, fmt.Errorf("tars: 数据不足")
	}
	b := r.buf[r.pos]
	r.pos++
	tag := (b & 0xF0) >> 4
	typ := b & 0x0F
	if tag == 15 {
		if r.pos >= len(r.buf) {
			return tarsHead{}, fmt.Errorf("tars: 扩展 tag 数据不足")
		}
		tag = r.buf[r.pos]
		r.pos++
	}
	return tarsHead{tag: tag, typ: typ}, nil
}

// find 从当前位置向后找一个 tag 匹配的字段，途中跳过其它字段。
// 找不到时回退到起点（对齐 crate 的 TarsTagNotFoundErr 行为）。
func (r *tarsReader) find(tag uint8) (tarsHead, error) {
	start := r.pos
	for r.pos < len(r.buf) {
		head, err := r.takeHead()
		if err != nil {
			break
		}
		if head.tag == tag && head.typ != tStructEnd {
			return head, nil
		}
		if err := r.skipField(head.typ); err != nil {
			break
		}
	}
	r.pos = start
	return tarsHead{}, fmt.Errorf("tars: 找不到 tag=%d", tag)
}

func (r *tarsReader) skipField(typ uint8) error {
	advance := func(n int) error {
		if r.pos+n > len(r.buf) {
			return fmt.Errorf("tars: 跳过失败")
		}
		r.pos += n
		return nil
	}

	switch typ {
	case tInt8:
		return advance(1)
	case tInt16:
		return advance(2)
	case tInt32, tFloat:
		return advance(4)
	case tInt64, tDouble:
		return advance(8)
	case tZero, tStructEnd:
		return nil
	case tString1:
		if r.pos >= len(r.buf) {
			return fmt.Errorf("tars: 数据不足")
		}
		size := int(r.buf[r.pos])
		r.pos++
		return advance(size)
	case tString4:
		if r.pos+4 > len(r.buf) {
			return fmt.Errorf("tars: 数据不足")
		}
		size := int(r.buf[r.pos])<<24 | int(r.buf[r.pos+1])<<16 | int(r.buf[r.pos+2])<<8 | int(r.buf[r.pos+3])
		r.pos += 4
		return advance(size)
	case tSimple:
		if _, err := r.takeHead(); err != nil { // 元素类型
			return err
		}
		_ = r.readInt32(0, 0)
		return advance(r.lastSize)
	case tMaps:
		count := int(r.readInt32(0, 0))
		for i := 0; i < count*2; i++ {
			head, err := r.takeHead()
			if err != nil {
				return err
			}
			if err := r.skipField(head.typ); err != nil {
				return err
			}
		}
		return nil
	case tList:
		count := int(r.readInt32(0, 0))
		for i := 0; i < count; i++ {
			head, err := r.takeHead()
			if err != nil {
				return err
			}
			if err := r.skipField(head.typ); err != nil {
				return err
			}
		}
		return nil
	case tStructBeg:
		for r.pos < len(r.buf) {
			head, err := r.takeHead()
			if err != nil {
				return err
			}
			if head.typ == tStructEnd {
				return nil
			}
			if err := r.skipField(head.typ); err != nil {
				return err
			}
		}
		return fmt.Errorf("tars: 结构体未结束")
	}
	return fmt.Errorf("tars: 未知类型 %d", typ)
}

// readInt32Tag 按 tag 搜索读取 int32。
func (r *tarsReader) readInt32Tag(tag uint8, def int32) int32 {
	head, err := r.find(tag)
	if err != nil {
		return def
	}
	return r.intFromHead(head, def)
}

// readInt32 顺序读取（不做 tag 搜索），用于 map/list 的计数。
func (r *tarsReader) readInt32(tag uint8, def int32) int32 {
	head, err := r.takeHead()
	if err != nil {
		return def
	}
	if head.tag != tag {
		// 计数位置出现了别的 tag：回退并当作缺失
		r.pos--
		return def
	}
	return r.intFromHead(head, def)
}

// intFromHead 按类型解出整数值（含各种压缩形式）。
func (r *tarsReader) intFromHead(head tarsHead, def int32) int32 {
	var v int64
	switch head.typ {
	case tZero:
		return 0
	case tInt8:
		if r.pos+1 > len(r.buf) {
			return def
		}
		v = int64(int8(r.buf[r.pos]))
		r.pos++
	case tInt16:
		if r.pos+2 > len(r.buf) {
			return def
		}
		v = int64(int16(uint16(r.buf[r.pos])<<8 | uint16(r.buf[r.pos+1])))
		r.pos += 2
	case tInt32:
		if r.pos+4 > len(r.buf) {
			return def
		}
		v = int64(int32(uint32(r.buf[r.pos])<<24 | uint32(r.buf[r.pos+1])<<16 |
			uint32(r.buf[r.pos+2])<<8 | uint32(r.buf[r.pos+3])))
		r.pos += 4
	case tInt64:
		if r.pos+8 > len(r.buf) {
			return def
		}
		v = int64(uint64(r.buf[r.pos])<<56 | uint64(r.buf[r.pos+1])<<48 |
			uint64(r.buf[r.pos+2])<<40 | uint64(r.buf[r.pos+3])<<32 |
			uint64(r.buf[r.pos+4])<<24 | uint64(r.buf[r.pos+5])<<16 |
			uint64(r.buf[r.pos+6])<<8 | uint64(r.buf[r.pos+7]))
		r.pos += 8
	default:
		return def
	}
	r.lastSize = int(v)
	return int32(v)
}

func (r *tarsReader) readInt64Tag(tag uint8, def int64) int64 {
	head, err := r.find(tag)
	if err != nil {
		return def
	}
	return int64(r.intFromHead(head, int32(def)))
}

func (r *tarsReader) readStringTag(tag uint8, def string) string {
	head, err := r.find(tag)
	if err != nil {
		return def
	}
	switch head.typ {
	case tZero:
		return def
	case tString1:
		if r.pos+1 > len(r.buf) {
			return def
		}
		size := int(r.buf[r.pos])
		r.pos++
		if r.pos+size > len(r.buf) {
			return def
		}
		s := string(r.buf[r.pos : r.pos+size])
		r.pos += size
		return s
	case tString4:
		if r.pos+4 > len(r.buf) {
			return def
		}
		size := int(r.buf[r.pos])<<24 | int(r.buf[r.pos+1])<<16 | int(r.buf[r.pos+2])<<8 | int(r.buf[r.pos+3])
		r.pos += 4
		if r.pos+size > len(r.buf) {
			return def
		}
		s := string(r.buf[r.pos : r.pos+size])
		r.pos += size
		return s
	}
	return def
}

func (r *tarsReader) readBytesTag(tag uint8) ([]byte, error) {
	head, err := r.find(tag)
	if err != nil {
		return nil, err
	}
	if head.typ != tSimple {
		return nil, fmt.Errorf("tars: tag=%d 不是字节数组（type=%d）", tag, head.typ)
	}
	// 元素类型头（crate 里固定 EnInt8），读完忽略
	if _, err := r.takeHead(); err != nil {
		return nil, err
	}
	size := int(r.readInt32(0, 0))
	if size < 0 || r.pos+size > len(r.buf) {
		return nil, fmt.Errorf("tars: 字节数组长度异常 %d", size)
	}
	out := r.buf[r.pos : r.pos+size]
	r.pos += size
	return out, nil
}

// readStructBegin 定位结构体起点（tag 匹配且类型为 struct 开始）。
func (r *tarsReader) readStructBegin(tag uint8) error {
	head, err := r.find(tag)
	if err != nil {
		return err
	}
	if head.typ != tStructBeg {
		return fmt.Errorf("tars: tag=%d 不是结构体（type=%d）", tag, head.typ)
	}
	return nil
}
