package douyin

import "time"

// 本文件是抖音 a_bogus 反爬签名的 Go 移植，逐行对齐旧项目的 a_bogus.rs。
//
// 算法由四部分组成（顺序不能改）：
//  1. SM3 哈希（国密，非 SHA-256）——用于把 query/UA/suffix 压成摘要
//  2. RC4 加密（注意：旧实现按"字符标量→字节"截断，等价于按字节处理）
//  3. 自定义 base64 变体（s0~s4 五张表，字节集不是标准 base64）
//  4. 一个 44 项的字节数组拼装（含时间戳、aid、pageId、校验和），再 RC4
//
// 校验方式只有一个：拿真实接口试。签名错一个字节，抖音直接返回空数据。

/* ------------------------------------------------------------------ SM3 */

// sm3IV 是 SM3 的标准初始寄存器值。
var sm3IV = [8]uint32{
	0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600,
	0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E,
}

func rotl32(x uint32, n uint32) uint32 {
	n %= 32
	if n == 0 {
		return x
	}
	return (x << n) | (x >> (32 - n))
}

func sm3Tj(j int) uint32 {
	if j < 16 {
		return 0x79CC4519
	}
	return 0x7A879D8A
}

func sm3Ff(j int, x, y, z uint32) uint32 {
	if j < 16 {
		return x ^ y ^ z
	}
	return (x & y) | (x & z) | (y & z)
}

func sm3Gg(j int, x, y, z uint32) uint32 {
	if j < 16 {
		return x ^ y ^ z
	}
	return (x & y) | (^x & z)
}

// sm3Compress 压缩一个 64 字节块，就地更新寄存器。
func sm3Compress(reg *[8]uint32, block []byte) {
	var w [132]uint32
	for t := 0; t < 16; t++ {
		i := 4 * t
		w[t] = uint32(block[i])<<24 | uint32(block[i+1])<<16 | uint32(block[i+2])<<8 | uint32(block[i+3])
	}
	for j := 16; j < 68; j++ {
		a := w[j-16] ^ w[j-9] ^ rotl32(w[j-3], 15)
		a = a ^ rotl32(a, 15) ^ rotl32(a, 23)
		w[j] = a ^ rotl32(w[j-13], 7) ^ w[j-6]
	}
	for j := 0; j < 64; j++ {
		w[j+68] = w[j] ^ w[j+4]
	}

	a, b, c, d := reg[0], reg[1], reg[2], reg[3]
	e, f, g, h := reg[4], reg[5], reg[6], reg[7]

	for j := 0; j < 64; j++ {
		ss1 := rotl32(rotl32(a, 12)+e+rotl32(sm3Tj(j), uint32(j)), 7)
		ss2 := ss1 ^ rotl32(a, 12)
		tt1 := sm3Ff(j, a, b, c) + d + ss2 + w[j+68]
		tt2 := sm3Gg(j, e, f, g) + h + ss1 + w[j]

		d = c
		c = rotl32(b, 9)
		b = a
		a = tt1
		h = g
		g = rotl32(f, 19)
		f = e
		e = tt2 ^ rotl32(tt2, 9) ^ rotl32(tt2, 17)
	}

	reg[0] ^= a
	reg[1] ^= b
	reg[2] ^= c
	reg[3] ^= d
	reg[4] ^= e
	reg[5] ^= f
	reg[6] ^= g
	reg[7] ^= h
}

// sm3Sum 计算 SM3 摘要（32 字节）。
func sm3Sum(data []byte) []byte {
	reg := sm3IV
	remaining := data

	for len(remaining) >= 64 {
		sm3Compress(&reg, remaining[:64])
		remaining = remaining[64:]
	}

	// 填充块
	buf := make([]byte, 0, 64)
	buf = append(buf, remaining...)
	buf = append(buf, 0x80)
	for len(buf)%64 != 56 {
		buf = append(buf, 0)
	}
	bitLength := uint64(len(data)) * 8
	buf = append(buf,
		byte(bitLength>>56), byte(bitLength>>48), byte(bitLength>>40), byte(bitLength>>32),
		byte(bitLength>>24), byte(bitLength>>16), byte(bitLength>>8), byte(bitLength))

	for i := 0; i < len(buf); i += 64 {
		sm3Compress(&reg, buf[i:i+64])
	}

	out := make([]byte, 0, 32)
	for _, v := range reg {
		out = append(out, byte(v>>24), byte(v>>16), byte(v>>8), byte(v))
	}
	return out
}

/* ------------------------------------------------------------------ RC4 */

// rc4Encrypt 按旧实现的语义做 RC4：明文与密钥都按"字节"处理。
//
// 旧代码把 char 转成 u32 再截断成 u8，对 ASCII 以及 Latin-1 范围的字节
// 与直接按字节操作完全等价。
func rc4Encrypt(plaintext []byte, key []byte) []byte {
	s := make([]int, 256)
	for i := 0; i < 256; i++ {
		s[i] = i
	}
	j := 0
	for i := 0; i < 256; i++ {
		j = (j + s[i] + int(key[i%len(key)])) % 256
		s[i], s[j] = s[j], s[i]
	}

	i := 0
	j = 0
	out := make([]byte, 0, len(plaintext))
	for _, ch := range plaintext {
		i = (i + 1) % 256
		j = (j + s[i]) % 256
		s[i], s[j] = s[j], s[i]
		t := (s[i] + s[j]) % 256
		out = append(out, ch^byte(s[t]))
	}
	return out
}

/* -------------------------------------------------------- 自定义 base64 */

// 五张编码表（与旧实现一致；注意 s0 是标准表，其余是抖音变体）。
var encodeTables = map[string]string{
	"s0": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
	"s1": "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
	"s2": "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
	"s3": "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
	"s4": "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe",
}

var (
	encodeMasks  = [4]uint32{16515072, 258048, 4032, 63}
	encodeShifts = [4]uint32{18, 12, 6, 0}
)

// getLongInt 从数据里取第 roundNum 组的 3 个字节拼成 24 位整数。
func getLongInt(roundNum int, data []byte) uint32 {
	i := roundNum * 3
	var b1, b2, b3 uint32
	if i < len(data) {
		b1 = uint32(data[i])
	}
	if i+1 < len(data) {
		b2 = uint32(data[i+1])
	}
	if i+2 < len(data) {
		b3 = uint32(data[i+2])
	}
	return (b1 << 16) | (b2 << 8) | b3
}

// resultEncrypt 用指定表把字节编码成字符串。
func resultEncrypt(data []byte, table string) string {
	t := encodeTables[table]
	out := make([]byte, 0, len(data)*4/3+4)
	totalChars := (len(data) / 3) * 4
	if len(data)%3 != 0 {
		totalChars += 4
	}

	roundNum := 0
	longInt := getLongInt(0, data)
	for i := 0; i < totalChars; i++ {
		if i/4 != roundNum {
			roundNum++
			longInt = getLongInt(roundNum, data)
		}
		idx := i % 4
		charIndex := (longInt & encodeMasks[idx]) >> encodeShifts[idx]
		out = append(out, t[charIndex])
	}
	return string(out)
}

/* ------------------------------------------------------------- 随机串 */

// generRandom 生成 4 字节的"随机"字节（旧实现用固定常量，因此结果恒定）。
func generRandom(randomNum int32, option [2]int32) []byte {
	byte1 := randomNum & 255
	byte2 := (randomNum >> 8) & 255
	return []byte{
		byte((byte1 & 170) | (option[0] & 85)),
		byte((byte1 & 85) | (option[0] & 170)),
		byte((byte2 & 170) | (option[1] & 85)),
		byte((byte2 & 85) | (option[1] & 170)),
	}
}

// generateRandomStr 返回 12 字节的固定前缀串。
//
// 旧实现名为"随机"，实际用的是三个写死的浮点常量，所以每次输出一样。
// 这里保持同样行为——换成真随机会让签名与参考实现不一致，风险更大。
func generateRandomStr() []byte {
	vals := []float64{0.123456789, 0.987654321, 0.555555555}
	out := make([]byte, 0, 12)
	out = append(out, generRandom(int32(vals[0]*10000.0), [2]int32{3, 45})...)
	out = append(out, generRandom(int32(vals[1]*10000.0), [2]int32{1, 0})...)
	out = append(out, generRandom(int32(vals[2]*10000.0), [2]int32{1, 5})...)
	return out
}

/* ------------------------------------------------------------ 主体拼装 */

// splitToBytes 把 i64 拆成 4 个大端字节序的字节。
func splitToBytes(num int64) [4]int64 {
	return [4]int64{
		(num >> 24) & 255,
		(num >> 16) & 255,
		(num >> 8) & 255,
		num & 255,
	}
}

// generateRC4BBStr 构造 44 项主表并做 RC4，再编码。
//
// suffix 恒为 "cus"，arguments 恒为 [0,1,14]，这两个参数旧实现就是写死的。
func generateRC4BBStr(query, userAgent, windowEnvStr, suffix string, arguments [3]int32) []byte {
	startTime := time.Now().UnixMilli()

	// 双重 SM3（对齐上游 Python 行为，单次哈希结果不同）
	urlList := sm3Sum(sm3Sum([]byte(query + suffix)))
	cusOnce := sm3Sum([]byte(suffix))
	cus := sm3Sum(cusOnce)
	uaKey := []byte{0, 1, 14}
	ua := sm3Sum([]byte(resultEncrypt(rc4Encrypt([]byte(userAgent), uaKey), "s3")))

	endTime := startTime + 100

	b := make([]int64, 80)
	b[8] = 3
	b[10] = endTime
	b[16] = startTime
	b[18] = 44

	stBytes := splitToBytes(b[16])
	b[20], b[21], b[22], b[23] = stBytes[0], stBytes[1], stBytes[2], stBytes[3]
	b[24] = (b[16] / 256 / 256 / 256 / 256) & 255
	b[25] = (b[16] / 256 / 256 / 256 / 256 / 256) & 255

	arg0Bytes := splitToBytes(int64(arguments[0]))
	b[26], b[27], b[28], b[29] = arg0Bytes[0], arg0Bytes[1], arg0Bytes[2], arg0Bytes[3]

	b[30] = int64(arguments[1]/256) & 255
	b[31] = int64(arguments[1]%256) & 255

	arg1Bytes := splitToBytes(int64(arguments[1]))
	b[32], b[33] = arg1Bytes[0], arg1Bytes[1]

	arg2Bytes := splitToBytes(int64(arguments[2]))
	b[34], b[35], b[36], b[37] = arg2Bytes[0], arg2Bytes[1], arg2Bytes[2], arg2Bytes[3]

	b[38] = byteAt(urlList, 21)
	b[39] = byteAt(urlList, 22)
	b[40] = byteAt(cus, 21)
	b[41] = byteAt(cus, 22)
	b[42] = byteAt(ua, 23)
	b[43] = byteAt(ua, 24)

	etBytes := splitToBytes(b[10])
	b[44], b[45], b[46], b[47] = etBytes[0], etBytes[1], etBytes[2], etBytes[3]
	b[48] = b[8]
	b[49] = (b[10] / 256 / 256 / 256 / 256) & 255
	b[50] = (b[10] / 256 / 256 / 256 / 256 / 256) & 255

	const pageID = 110624
	b[51] = pageID
	pageBytes := splitToBytes(pageID)
	b[52], b[53], b[54], b[55] = pageBytes[0], pageBytes[1], pageBytes[2], pageBytes[3]

	const aid = 6383
	b[56] = aid
	b[57] = aid & 255
	b[58] = (aid >> 8) & 255
	b[59] = (aid >> 16) & 255
	b[60] = (aid >> 24) & 255

	windowEnv := []byte(windowEnvStr)
	b[64] = int64(len(windowEnv))
	b[65] = int64(len(windowEnv)) & 255
	b[66] = int64(len(windowEnv)) >> 8 & 255
	b[69] = 0
	b[70] = 0
	b[71] = 0

	checksum := b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42] ^
		b[21] ^ b[27] ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43] ^
		b[22] ^ b[28] ^ b[32] ^ b[36] ^
		b[23] ^ b[29] ^ b[33] ^ b[37] ^
		b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48] ^ b[49] ^ b[50] ^
		b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55] ^
		b[57] ^ b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71]
	b[72] = checksum

	bb := []byte{
		byte(b[18]), byte(b[20]), byte(b[52]), byte(b[26]), byte(b[30]), byte(b[34]),
		byte(b[58]), byte(b[38]), byte(b[40]), byte(b[53]), byte(b[42]), byte(b[21]),
		byte(b[27]), byte(b[54]), byte(b[55]), byte(b[31]), byte(b[35]), byte(b[57]),
		byte(b[39]), byte(b[41]), byte(b[43]), byte(b[22]), byte(b[28]), byte(b[32]),
		byte(b[60]), byte(b[36]), byte(b[23]), byte(b[29]), byte(b[33]), byte(b[37]),
		byte(b[44]), byte(b[45]), byte(b[59]), byte(b[46]), byte(b[47]), byte(b[48]),
		byte(b[49]), byte(b[50]), byte(b[24]), byte(b[25]), byte(b[65]), byte(b[66]),
		byte(b[70]), byte(b[71]),
	}
	bb = append(bb, windowEnv...)
	bb = append(bb, byte(checksum))

	// 最后用单字节密钥 'y' 再 RC4
	return rc4Encrypt(bb, []byte{'y'})
}

func byteAt(data []byte, i int) int64 {
	if i < len(data) {
		return int64(data[i])
	}
	return 0
}

// windowEnv 是固定的窗口环境指纹（旧实现写死）。
const windowEnv = "1920|1080|1920|1040|0|30|0|0|1872|92|1920|1040|1857|92|1|24|Win32"

// defaultSuffix 与 defaultArguments 是旧实现里写死的两个常量。
const defaultSuffix = "cus"

var defaultArguments = [3]int32{0, 1, 14}

// GenerateABogus 生成 a_bogus 签名值（含结尾的 "="）。
//
// query 是 URL 上除 a_bogus 之外的全部参数串（**已 urlencode 的原始顺序**），
// userAgent 必须与请求头一致，否则签名校验不过。
func GenerateABogus(query, userAgent string) string {
	body := generateRC4BBStr(query, userAgent, windowEnv, defaultSuffix, defaultArguments)
	combined := append(generateRandomStr(), body...)
	return resultEncrypt(combined, "s4") + "="
}
