// 本地日期（Asia/Shanghai，由服务器时区决定）格式化工具
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 紧凑日期（YYYYMMDD），用于单号前缀
export function localDateCompact(d: Date = new Date()): string {
  return localDateStr(d).replace(/-/g, "");
}

// 把 YYYY-MM-DD 解析为“本地时区”当天 00:00:00（避免 new Date("YYYY-MM-DD") 被当作 UTC）
export function parseLocalDateStart(value: string): Date {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

// 把 YYYY-MM-DD 解析为“本地时区”当天 23:59:59.999
export function parseLocalDateEnd(value: string): Date {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

// 本地时区当天 00:00:00（用于“是否逾期”等按自然日比较）
export function startOfLocalDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}