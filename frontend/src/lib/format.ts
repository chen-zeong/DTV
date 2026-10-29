/** 数字/文本格式化工具（旧项目把这类函数散落在 5、6 个组件里） */

/** 人气值：1200 → 1200；12345 → 1.2万；1234567 → 123.5万 */
export function formatViewers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10000) return String(Math.round(n));
  const wan = n / 10000;
  if (wan < 10) return `${wan.toFixed(1)}万`;
  return `${Math.round(wan)}万`;
}

/** 覆盖率：昵称哈希 → 稳定的色相，用于弹幕用户名配色 */
export function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 70% 72%)`;
}

/** 取昵称首个字符做头像兜底 */
export function initial(name: string): string {
  return (name || "?").trim().slice(0, 1);
}

/** mm:ss（弹幕面板时间戳用） */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
