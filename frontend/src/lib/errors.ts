/**
 * 与 Go 侧 internal/platforms/common/errors.go 约定一致不需要重试的错误标记。
 *
 * 如房间不存在、被风控拦截、房间号无效等命中前缀的错误
 * 不触发自动重连
 */
const FATAL_PREFIX = "FATAL_ERROR:";

export function isFatalError(message: string): boolean {
  return message.startsWith(FATAL_PREFIX);
}

/** 去掉前缀 */
export function stripFatalPrefix(message: string): string {
  return isFatalError(message) ? message.slice(FATAL_PREFIX.length) : message;
}
