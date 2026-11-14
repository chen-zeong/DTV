package common

import "fmt"

// fatalPrefix 标记不需要重试的错误。
//
// frontend/src/lib/errors.ts 据此判断：命中前缀就不再触发自动重连，
// 将去掉前缀后的错误信息展示给用户。
const fatalPrefix = "FATAL_ERROR:"

// Fatal 构造一个不需要重试的错误
//
// 如房间不存在、被风控拦截、房间号无效等
// 这类错误再试一次结果也不会变，自动重试并无意义
func Fatal(format string, args ...any) error {
	return fmt.Errorf("%s%s", fatalPrefix, fmt.Sprintf(format, args...))
}
