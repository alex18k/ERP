export type QueryOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'range'
export type QueryFieldType = 'text' | 'number' | 'date' | 'enum'

export interface QueryFieldOption {
  label: string
  value: string | number
}

export interface QueryField {
  field: string
  label: string
  type: QueryFieldType
  options?: QueryFieldOption[]
  placeholder?: string
  width?: number
}

export interface QueryCondition {
  field: string
  operator: QueryOperator
  value?: any
  value2?: any
}

export const OPERATOR_LABELS: Record<QueryOperator, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  contains: '包含',
  range: '范围',
}

const OPERATOR_BY_TYPE: Record<QueryFieldType, QueryOperator[]> = {
  text: ['eq', 'ne', 'contains'],
  number: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'range'],
  date: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'range'],
  enum: ['eq', 'ne'],
}

const ALL_OPERATORS: QueryOperator[] = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'range']

export function operatorOptionsForType(type: QueryFieldType) {
  const allowed = new Set(OPERATOR_BY_TYPE[type] || [])
  return ALL_OPERATORS.map((operator) => ({
    value: operator,
    label: OPERATOR_LABELS[operator],
    disabled: !allowed.has(operator),
  }))
}

export function defaultOperatorForType(type: QueryFieldType): QueryOperator {
  if (type === 'text') return 'contains'
  return (OPERATOR_BY_TYPE[type] || ['eq'])[0]
}

export function isOperatorAllowed(type: QueryFieldType, operator: QueryOperator) {
  return (OPERATOR_BY_TYPE[type] || []).includes(operator)
}

export function createEmptyCondition(field = ''): QueryCondition {
  return { field, operator: 'eq', value: null, value2: null }
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function cleanNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function cleanDate(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  return text.slice(0, 10)
}

export function normalizeCondition(condition: QueryCondition, fields: QueryField[]): QueryCondition | null {
  const fieldDef = fields.find((f) => f.field === condition.field)
  if (!fieldDef) return null
  const operator = isOperatorAllowed(fieldDef.type, condition.operator) ? condition.operator : defaultOperatorForType(fieldDef.type)
  const value = fieldDef.type === 'number' ? cleanNumber(condition.value) : fieldDef.type === 'date' ? cleanDate(condition.value) : cleanText(condition.value)
  const value2 = fieldDef.type === 'number' ? cleanNumber(condition.value2) : fieldDef.type === 'date' ? cleanDate(condition.value2) : cleanText(condition.value2)
  const row: QueryCondition = { field: fieldDef.field, operator, value, value2 }
  if (operator === 'range') {
    if (value == null && value2 == null) return null
  } else if (value == null) {
    return null
  }
  return row
}

export function normalizeConditions(conditions: QueryCondition[], fields: QueryField[]): QueryCondition[] {
  return conditions.map((c) => normalizeCondition(c, fields)).filter(Boolean) as QueryCondition[]
}

export function validateConditions(conditions: QueryCondition[], fields: QueryField[]): { ok: boolean; message?: string; normalized: QueryCondition[] } {
  const normalized = normalizeConditions(conditions, fields)
  for (let i = 0; i < conditions.length; i++) {
    const raw = conditions[i]
    const fieldDef = fields.find((f) => f.field === raw.field)
    if (!fieldDef) continue
    const operator = isOperatorAllowed(fieldDef.type, raw.operator) ? raw.operator : defaultOperatorForType(fieldDef.type)
    const hasValue = raw.value !== '' && raw.value !== null && raw.value !== undefined
    const hasValue2 = raw.value2 !== '' && raw.value2 !== null && raw.value2 !== undefined
    const rowLabel = `第 ${i + 1} 行查询条件`
    if (operator === 'range') {
      if (!hasValue && !hasValue2) return { ok: false, message: `${rowLabel}的范围至少填写一个值`, normalized }
      if (fieldDef.type === 'number' && hasValue && cleanNumber(raw.value) === null) return { ok: false, message: `${rowLabel}的数值不正确`, normalized }
      if (fieldDef.type === 'number' && hasValue2 && cleanNumber(raw.value2) === null) return { ok: false, message: `${rowLabel}的数值不正确`, normalized }
      if (fieldDef.type === 'number' && hasValue && hasValue2) {
        const min = cleanNumber(raw.value)!
        const max = cleanNumber(raw.value2)!
        if (min > max) return { ok: false, message: `${rowLabel}的范围起始值不能大于结束值`, normalized }
      }
      if (fieldDef.type === 'date' && hasValue && hasValue2 && String(raw.value) > String(raw.value2)) {
        return { ok: false, message: `${rowLabel}的范围起始日期不能大于结束日期`, normalized }
      }
    } else if (!hasValue) {
      return { ok: false, message: `${rowLabel}缺少查询值`, normalized }
    }
  }
  if (normalized.length === 0 && conditions.some((c) => c.field || c.value || c.value2)) {
    return { ok: true, normalized: [] }
  }
  return { ok: true, normalized }
}

export function serializeConditions(conditions: QueryCondition[]): string | undefined {
  if (!conditions.length) return undefined
  return JSON.stringify(
    conditions.map((c) => {
      const out: QueryCondition = { field: c.field, operator: c.operator }
      if (c.value !== null && c.value !== undefined && c.value !== '') out.value = c.value
      if (c.value2 !== null && c.value2 !== undefined && c.value2 !== '') out.value2 = c.value2
      return out
    }),
  )
}
