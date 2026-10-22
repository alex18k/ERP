import { parseLocalDateEnd, parseLocalDateStart } from "./date";
import { type QueryCondition, type QueryFieldType, type QueryOperator } from "./queryConditions";

/**
 * 高级查询条件 → Prisma where 片段构造器
 * 与 utils/queryConditions.ts（原生 SQL 版）配套，用于 Prisma ORM 查询的列表接口
 */
export interface PrismaQueryFieldDefinition {
  type: QueryFieldType;
  /** 直接映射到 Prisma 字段名 */
  column?: string;
  /**
   * 关联过滤：
   * - name：关系名（to-many 用 some 匹配；to-one 直接匹配）
   * - toMany：关系是否为一对多（true 时用 some）
   * - inner：关系内 further 嵌套路径，如 ["material"]
   * 同一 name 的多个条件会合并为同一个 where 片段（AND），保证命中同一条关联记录
   */
  relation?: { name: string; toMany?: boolean; inner?: string[] };
  /** 自定义 where 片段构造（优先于 column/relation） */
  build?: (value: any, value2: any, operator: QueryOperator) => any;
  options?: { label: string; value: string | number }[];
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
  if (!text || !/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  return text.slice(0, 10);
}

/** 生成列级过滤条件（不含字段名） */
function textFilter(operator: QueryOperator, value: string) {
  if (operator === "contains") return { contains: value, mode: "insensitive" };
  return value;
}

function numberFilter(operator: QueryOperator, value: number | null, value2: number | null) {
  if (operator === "eq") return value;
  if (operator === "gt") return { gt: value };
  if (operator === "lt") return { lt: value };
  // range
  const rawMin = value ?? value2!;
  const rawMax = value2 ?? value!;
  const low = Math.min(rawMin, rawMax);
  const high = Math.max(rawMin, rawMax);
  const filter: any = {};
  if (value === null) filter.lte = high;
  else if (value2 === null) filter.gte = low;
  else {
    filter.gte = low;
    filter.lte = high;
  }
  return filter;
}

function dateFilter(operator: QueryOperator, value: string | null, value2: string | null) {
  if (operator === "eq") return { gte: parseLocalDateStart(value!), lte: parseLocalDateEnd(value!) };
  if (operator === "gt") return { gt: parseLocalDateEnd(value!) };
  if (operator === "lt") return { lt: parseLocalDateStart(value!) };
  // range
  const filter: any = {};
  if (!value) filter.lte = parseLocalDateEnd(value2!);
  else if (!value2) filter.gte = parseLocalDateStart(value);
  else {
    filter.gte = parseLocalDateStart(value);
    filter.lte = parseLocalDateEnd(value2);
  }
  return filter;
}

/** 各类型允许的运算符 */
const ALLOWED_OPERATORS: Record<QueryFieldType, QueryOperator[]> = {
  text: ["eq", "contains"],
  number: ["eq", "gt", "lt", "range"],
  date: ["eq", "gt", "lt", "range"],
  enum: ["eq"],
};

/** 校验运算符与枚举取值（对 build 自定义构造同样生效） */
function validateCondition(def: PrismaQueryFieldDefinition, condition: QueryCondition): void {
  if (!ALLOWED_OPERATORS[def.type].includes(condition.operator)) {
    throw new Error(`查询字段 ${condition.field} 不支持运算符 ${condition.operator}`);
  }
  if (def.type === "enum") {
    const raw = condition.value;
    if (raw === null || raw === undefined || raw === "") throw new Error(`查询字段 ${condition.field} 缺少值`);
    if (Array.isArray(def.options) && !def.options.some((option) => String(option.value) === String(raw))) {
      throw new Error(`查询字段 ${condition.field} 的值不正确`);
    }
  }
}

/** 计算列级过滤条件 */
function columnFilterOf(def: PrismaQueryFieldDefinition, condition: QueryCondition): any {
  validateCondition(def, condition);

  if (def.type === "enum") {
    return condition.value;
  }

  if (def.type === "text") {
    const value = cleanText(condition.value);
    if (!value) throw new Error(`查询字段 ${condition.field} 缺少值`);
    return textFilter(condition.operator, value);
  }

  if (def.type === "number") {
    const value = cleanNumber(condition.value);
    const value2 = cleanNumber(condition.value2);
    if (condition.operator === "range") {
      if (value === null && value2 === null) throw new Error(`查询字段 ${condition.field} 的范围至少填写一个值`);
    } else if (value === null) throw new Error(`查询字段 ${condition.field} 需要数字`);
    return numberFilter(condition.operator, value, value2);
  }

  if (def.type === "date") {
    const value = cleanDate(condition.value);
    const value2 = cleanDate(condition.value2);
    if (condition.operator === "range") {
      if (!value && !value2) throw new Error(`查询字段 ${condition.field} 的范围至少填写一个日期`);
    } else if (!value) throw new Error(`查询字段 ${condition.field} 需要日期`);
    return dateFilter(condition.operator, value, value2);
  }

  throw new Error(`查询字段 ${condition.field} 类型不支持`);
}

/** 生成单个条件的 where 片段 */
function fragmentOf(def: PrismaQueryFieldDefinition, condition: QueryCondition): { key?: string; fragment: any } {
  if (def.build) {
    validateCondition(def, condition);
    const fragment = def.build(condition.value, condition.value2, condition.operator);
    return { fragment };
  }

  const column = def.column;
  if (!column) throw new Error(`查询字段 ${condition.field} 未配置过滤字段`);

  const columnFilter = columnFilterOf(def, condition);

  if (def.relation) {
    const { name, toMany, inner } = def.relation;
    // 关系内层：{ material: { code: <filter> } }
    let innerNode: any = { [column]: columnFilter };
    if (inner && inner.length) {
      for (let i = inner.length - 1; i >= 0; i--) {
        innerNode = { [inner[i]]: innerNode };
      }
    }
    if (toMany) return { key: name, fragment: { [name]: { some: innerNode } } };
    return { key: name, fragment: { [name]: innerNode } };
  }

  return { fragment: { [column]: columnFilter } };
}

/** 构造 where 片段数组（各条件之间为 AND） */
export function buildPrismaQueryFragments(conditions: QueryCondition[], fieldDefs: Record<string, PrismaQueryFieldDefinition>): any[] {
  const fragments: any[] = [];
  // 同一关系名的条件合并为一个片段（保证命中同一条关联记录）
  const relationBuckets = new Map<string, any[]>();

  for (const condition of conditions) {
    const def = fieldDefs[condition.field];
    if (!def) throw new Error(`不支持的查询字段：${condition.field}`);

    const { key, fragment } = fragmentOf(def, condition);
    if (key) {
      const bucket = relationBuckets.get(key) || [];
      bucket.push(fragment[key]);
      relationBuckets.set(key, bucket);
      continue;
    }
    fragments.push(fragment);
  }

  for (const [name, bucket] of relationBuckets.entries()) {
    if (bucket.length === 1) {
      fragments.push({ [name]: bucket[0] });
      continue;
    }
    // 合并为 AND：to-many → { name: { some: { AND: [...] } } }；to-one → { name: { AND: [...] } }
    const isToMany = bucket[0] && typeof bucket[0] === "object" && "some" in bucket[0];
    const innerList = isToMany ? bucket.map((b: any) => b.some) : bucket;
    fragments.push({ [name]: isToMany ? { some: { AND: innerList } } : { AND: innerList } });
  }

  return fragments;
}

/** 构造可直接合并进 filters 的 AND 条件 */
export function buildPrismaQueryWhere(conditions: QueryCondition[], fieldDefs: Record<string, PrismaQueryFieldDefinition>): any {
  const fragments = buildPrismaQueryFragments(conditions, fieldDefs);
  return fragments.length ? { AND: fragments } : {};
}
