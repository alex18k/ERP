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