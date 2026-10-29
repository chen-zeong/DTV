/** 轻量 classnames 工具（旧项目到处手写 `clsx` 风格拼接） */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
