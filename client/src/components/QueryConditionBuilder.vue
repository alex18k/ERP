<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createEmptyCondition,
  defaultOperatorForType,
  operatorOptionsForType,
  validateConditions,
  type QueryCondition,
  type QueryField,
} from '../utils/queryBuilder'

const props = defineProps<{
  fields: QueryField[]
  modelValue: QueryCondition[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: QueryCondition[]): void
  (e: 'query', value: QueryCondition[]): void
  (e: 'reset'): void
}>()

const rows = ref<QueryCondition[]>([createEmptyCondition()])

function cloneConditions(value: QueryCondition[]): QueryCondition[] {
  return (value || []).map((item) => ({ ...item }))
}

function currentFieldType(field: string) {
  return props.fields.find((f) => f.field === field)?.type || 'text'
}

function currentFieldDef(field: string) {
  return props.fields.find((f) => f.field === field)
}

function emitRows() {
  emit('update:modelValue', cloneConditions(rows.value))
}

watch(
  () => props.modelValue,
  (value) => {
    const next = cloneConditions(value || [])
    rows.value = next.length ? next : [createEmptyCondition()]
  },
  { immediate: true },
)

function onFieldChange(row: QueryCondition) {
  row.operator = defaultOperatorForType(currentFieldType(row.field))
  row.value = null
  row.value2 = null
  emitRows()
}

function onOperatorChange(row: QueryCondition) {
  if (row.operator !== 'range') row.value2 = null
  emitRows()
}

function addRow(index: number) {
  rows.value.splice(index + 1, 0, createEmptyCondition())
  emitRows()
}

function removeRow(index: number) {
  if (rows.value.length <= 1) {
    rows.value = [createEmptyCondition()]
  } else {
    rows.value.splice(index, 1)
  }
  emitRows()
}

function submit() {
  const result = validateConditions(rows.value, props.fields)
  if (!result.ok) {
    ElMessage.warning(result.message || '请完善查询条件')
    return
  }
  const normalized = result.normalized
  rows.value = normalized.length ? cloneConditions(normalized) : [createEmptyCondition()]
  emitRows()
  emit('query', cloneConditions(normalized))
}

function reset() {
  rows.value = [createEmptyCondition()]
  emitRows()
  emit('reset')
}
</script>

<template>
  <div class="query-builder">
    <div v-for="(row, index) in rows" :key="index" class="query-row">
      <span class="query-join">{{ index > 0 ? '并且' : '条件' }}</span>
      <el-select v-model="row.field" filterable placeholder="选择字段" class="query-field" @change="onFieldChange(row)">
        <el-option v-for="f in fields" :key="f.field" :label="f.label" :value="f.field" />
      </el-select>

      <el-select v-model="row.operator" placeholder="选择运算符" class="query-operator" :disabled="!row.field" @change="onOperatorChange(row)">
        <el-option
          v-for="op in operatorOptionsForType(currentFieldType(row.field))"
          :key="op.value"
          :label="op.label"
          :value="op.value"
          :disabled="op.disabled"
        />
      </el-select>

      <template v-if="row.field && row.operator === 'range' && currentFieldType(row.field) === 'date'">
        <el-date-picker v-model="row.value" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" class="query-value query-value--date" @change="emitRows" />
        <span class="query-range-sep">至</span>
        <el-date-picker v-model="row.value2" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" class="query-value query-value--date" @change="emitRows" />
      </template>

      <template v-else-if="row.field && row.operator === 'range' && currentFieldType(row.field) === 'number'">
        <el-input-number v-model="row.value" :controls="false" placeholder="最小值" class="query-value query-value--number" @change="emitRows" />
        <span class="query-range-sep">至</span>
        <el-input-number v-model="row.value2" :controls="false" placeholder="最大值" class="query-value query-value--number" @change="emitRows" />
      </template>

      <template v-else-if="row.field && currentFieldType(row.field) === 'date'">
        <el-date-picker v-model="row.value" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="query-value query-value--date" @change="emitRows" />
      </template>

      <template v-else-if="row.field && currentFieldType(row.field) === 'number'">
        <el-input-number v-model="row.value" :controls="false" :placeholder="currentFieldDef(row.field)?.placeholder || '数值'" class="query-value query-value--number" @change="emitRows" />
      </template>

      <template v-else-if="row.field && currentFieldType(row.field) === 'enum'">
        <el-select v-model="row.value" filterable clearable :placeholder="currentFieldDef(row.field)?.placeholder || '选择值'" class="query-value" @change="emitRows">
          <el-option v-for="option in currentFieldDef(row.field)?.options || []" :key="String(option.value)" :label="option.label" :value="option.value" />
        </el-select>
      </template>

      <template v-else>
        <el-input v-model="row.value" clearable :disabled="!row.field" :placeholder="currentFieldDef(row.field)?.placeholder || '查询值'" class="query-value" @keyup.enter="submit" @change="emitRows" />
      </template>

      <div class="query-row-actions">
        <el-button size="small" type="primary" plain @click="addRow(index)">
          <el-icon><Plus /></el-icon>
        </el-button>
        <el-button size="small" plain @click="removeRow(index)">
          <el-icon><Minus /></el-icon>
        </el-button>
      </div>

      <template v-if="index === rows.length - 1">
        <el-button type="primary" @click="submit"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="reset"><el-icon><RefreshLeft /></el-icon>重置</el-button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.query-builder {
  padding: 8px 0 2px;
}
.query-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.query-join {
  width: 36px;
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: center;
}
.query-field {
  width: 140px;
}
.query-operator {
  width: 92px;
}
.query-value {
  width: 180px;
}
.query-value--date {
  width: 150px;
}
.query-value--number {
  width: 120px;
}
.query-range-sep {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.query-row-actions {
  display: flex;
  gap: 4px;
}
</style>
