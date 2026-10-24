import { Prisma } from "@prisma/client";
import { parseLocalDateEnd, parseLocalDateStart } from "./date";

export type QueryOperator = "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains" | "range";
export type QueryFieldType = "text" | "number" | "date" | "enum";

export interface QueryCondition {
  field: string;
  operator: QueryOperator;
  value?: string | number | null;
  value2?: string | number | null;
}

export interface SqlQueryFieldDefinition {
  type: QueryFieldType;
  whereSql?: string;
  havingSql?: string;
  options?: { label: string; value: string | number }[];
}

export interface BuiltSqlQueryFilters {
  whereParts: Prisma.Sql[];
  havingParts: Prisma.Sql[];
}

const OPERATORS: QueryOperator[] = ["eq", "ne", "gt", "lt", "gte", "lte", "contains", "range"];

export function isQueryConditionError(error: any): boolean {
  return /查询(条件|字段)/.test(String(error?.message || ""));
}

const ALLOWED_OPERATORS: Record<QueryFieldType, QueryOperator[]> = {
  text: ["eq", "ne", "contains"],
  number: ["eq", "ne", "gt", "lt", "gte", "lte", "range"],
  date: ["eq", "ne", "gt", "lt", "gte", "lte", "range"],
  enum: ["eq", "ne"],
};

function escapeLike(value: any) {
  return String(value ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

function isDateValue(value: any): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value ?? ""));
}

function cleanText(value: any): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanNumber(value: any): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cleanDate(value: any): string | null {
  const text = cleanText(value);
  if (!text || !isDateValue(text)) return null;
  return text.slice(0, 10);
}

export function parseQueryConditions(raw: any, maxCount = 20): QueryCondition[] {
  if (!raw) return [];
  let parsed: any = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("查询条件格式不正确");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("查询条件格式不正确");
  if (parsed.length > maxCount) throw new Error(`查询条件最多 ${maxCount} 条`);

  return parsed.map((item: any, index: number) => {
    const field = String(item?.field ?? "").trim();
    const operator = String(item?.operator ?? "").trim() as QueryOperator;
    if (!field) throw new Error(`查询条件第 ${index + 1} 行缺少字段`);
    if (!OPERATORS.includes(operator)) throw new Error(`查询条件第 ${index + 1} 行运算符不正确`);
    return {
      field,
      operator,
      value: item?.value ?? item?.value1 ?? null,
      value2: item?.value2 ?? item?.value3 ?? null,
    };
  });
}

function compareByType(type: QueryFieldType, operator: QueryOperator, expr: Prisma.Sql, def: SqlQueryFieldDefinition, condition: QueryCondition): Prisma.Sql {
  if (!ALLOWED_OPERATORS[type].includes(operator)) {
    throw new Error(`查询字段 ${condition.field} 不支持运算符 ${operator}`);
  }
  const options = (def as any).options;

  if (operator === "contains") {
    const value = cleanText(condition.value);
    if (!value) throw new Error(`查询字段 ${condition.field} 缺少值`);
    return Prisma.sql`${expr} LIKE ${`%${escapeLike(value)}%`}`;
  }

  if (operator === "eq") {
    if (type === "number") {
      const value = cleanNumber(condition.value);
      if (value === null) throw new Error(`查询字段 ${condition.field} 需要数字`);
      return Prisma.sql`${expr} = ${value}`;
    }
    if (type === "date") {
      const value = cleanDate(condition.value);
      if (!value) throw new Error(`查询字段 ${condition.field} 需要日期`);
      return Prisma.sql`${expr} BETWEEN ${parseLocalDateStart(value)} AND ${parseLocalDateEnd(value)}`;
    }
    const value = cleanText(condition.value);
    if (!value) throw new Error(`查询字段 ${condition.field} 缺少值`);
    if (Array.isArray(options) && !options.some((option: any) => String(option.value) === String(value))) {
      throw new Error(`查询字段 ${condition.field} 的值不正确`);
    }
    return Prisma.sql`${expr} = ${value}`;
  }

  if (operator === "ne") {
    if (type === "number") {
      const value = cleanNumber(condition.value);
      if (value === null) throw new Error(`查询字段 ${condition.field} 需要数字`);
      return Prisma.sql`${expr} <> ${value}`;
    }
    if (type === "date") {
      const value = cleanDate(condition.value);
      if (!value) throw new Error(`查询字段 ${condition.field} 需要日期`);
      return Prisma.sql`(${expr} < ${parseLocalDateStart(value)} OR ${expr} > ${parseLocalDateEnd(value)})`;
    }
    const value = cleanText(condition.value);
    if (!value) throw new Error(`查询字段 ${condition.field} 缺少值`);
    if (Array.isArray(options) && !options.some((option: any) => String(option.value) === String(value))) {
      throw new Error(`查询字段 ${condition.field} 的值不正确`);
    }
    return Prisma.sql`${expr} <> ${value}`;
  }

  if (operator === "gt" || operator === "lt" || operator === "gte" || operator === "lte") {
    if (type === "number") {
      const value = cleanNumber(condition.value);
      if (value === null) throw new Error(`查询字段 ${condition.field} 需要数字`);
      if (operator === "gt") return Prisma.sql`${expr} > ${value}`;
      if (operator === "lt") return Prisma.sql`${expr} < ${value}`;
      if (operator === "gte") return Prisma.sql`${expr} >= ${value}`;
      return Prisma.sql`${expr} <= ${value}`;
    }
    if (type === "date") {
      const value = cleanDate(condition.value);
      if (!value) throw new Error(`查询字段 ${condition.field} 需要日期`);
      if (operator === "gt") return Prisma.sql`${expr} > ${parseLocalDateEnd(value)}`;
      if (operator === "lt") return Prisma.sql`${expr} < ${parseLocalDateStart(value)}`;
      if (operator === "gte") return Prisma.sql`${expr} >= ${parseLocalDateStart(value)}`;
      return Prisma.sql`${expr} <= ${parseLocalDateEnd(value)}`;
    }
    throw new Error(`查询字段 ${condition.field} 不支持运算符 ${operator}`);
  }

  if (operator === "range") {
    if (type === "number") {
      const rawMin = cleanNumber(condition.value);
      const rawMax = cleanNumber(condition.value2);
      if (rawMin === null && rawMax === null) throw new Error(`查询字段 ${condition.field} 的范围至少填写一个值`);
      const min = rawMin ?? rawMax!;
      const max = rawMax ?? rawMin!;
      const low = Math.min(min, max);
      const high = Math.max(min, max);
      if (rawMin === null) return Prisma.sql`${expr} <= ${high}`;
      if (rawMax === null) return Prisma.sql`${expr} >= ${low}`;
      return Prisma.sql`${expr} BETWEEN ${low} AND ${high}`;
    }
    if (type === "date") {
      const start = cleanDate(condition.value);
      const end = cleanDate(condition.value2);
      if (!start && !end) throw new Error(`查询字段 ${condition.field} 的范围至少填写一个日期`);
      if (!start) return Prisma.sql`${expr} <= ${parseLocalDateEnd(end!)}`;
      if (!end) return Prisma.sql`${expr} >= ${parseLocalDateStart(start)}`;
      if (start > end) throw new Error(`查询字段 ${condition.field} 的日期范围起始值不能大于结束值`);
      return Prisma.sql`${expr} BETWEEN ${parseLocalDateStart(start)} AND ${parseLocalDateEnd(end)}`;
    }
    throw new Error(`查询字段 ${condition.field} 不支持运算符 ${operator}`);
  }

  throw new Error(`查询条件运算符不正确`);
}

export function buildSqlQueryFilters(conditions: QueryCondition[], fieldDefs: Record<string, SqlQueryFieldDefinition>): BuiltSqlQueryFilters {
  const whereParts: Prisma.Sql[] = [];
  const havingParts: Prisma.Sql[] = [];

  for (const condition of conditions) {
    const def = fieldDefs[condition.field];
    if (!def) throw new Error(`不支持的查询字段：${condition.field}`);
    const expr = def.whereSql ? Prisma.raw(def.whereSql) : def.havingSql ? Prisma.raw(def.havingSql) : null;
    if (!expr) throw new Error(`查询字段 ${condition.field} 未配置过滤表达式`);
    const filter = compareByType(def.type, condition.operator, expr, def, condition);
    if (def.whereSql) whereParts.push(filter);
    else havingParts.push(filter);
  }

  return { whereParts, havingParts };
}
