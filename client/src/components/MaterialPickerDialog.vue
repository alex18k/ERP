<template>
  <el-dialog
    :model-value="modelValue"
    title="选择物料"
    width="880px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <div style="display: flex; gap: 8px; margin-bottom: 10px">
      <el-input
        v-model="keyword"
        placeholder="编码 / 名称 / 规格"
        clearable
        style="width: 240px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select v-model="materialType" clearable placeholder="物料类别" style="width: 160px" @change="reload">
        <el-option v-for="t in types" :key="t" :label="t" :value="t" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="reload">查询</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      size="small"
      highlight-current-row
      height="360"
      style="width: 100%"
      @current-change="(v: any) => (current = v)"
      @row-click="(v: any) => (current = v)"
      @row-dblclick="onConfirm"
    >
      <el-table-column prop="code" label="编码" width="120" />
      <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="specification" label="型号规格" min-width="160" show-overflow-tooltip />
      <el-table-column prop="unit" label="单位" width="70" />
      <el-table-column label="参考成本" width="90" align="right">
        <template #default="{ row }">{{ row.cost ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="最近采购价" width="100" align="right">
        <template #default="{ row }">{{ row.price ?? '-' }}</template>
      </el-table-column>
      <el-table-column prop="materialType" label="物料类别" width="120" show-overflow-tooltip />
    </el-table>

    <el-pagination
      small
      style="margin-top: 10px; justify-content: flex-end"
      layout="total, prev, pager, next, sizes"
      :total="total"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[20, 50, 100]"
      @current-change="load"
      @size-change="reload"
    />

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="!current" @click="onConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { materialApi } from '../api'

defineProps<{
  modelValue: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'select', material: any): void
}>()

const keyword = ref('')
const materialType = ref('')
const types = ref<string[]>([])
const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const current = ref<any>(null)

function onOpen() {
  current.value = null
  keyword.value = ''
  materialType.value = ''
  page.value = 1
  if (!types.value.length) loadTypes()
  reload()
}

async function loadTypes() {
  try {
    const res: any = await materialApi.types()
    types.value = res.data || []
  } catch { types.value = [] }
}

async function load() {
  loading.value = true
  try {
    const res: any = await materialApi.list({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value || undefined,
      materialType: materialType.value || undefined,
    })
    list.value = res.data?.items || []
    total.value = res.data?.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

function onConfirm() {
  if (!current.value) return
  emit('select', current.value)
  emit('update:modelValue', false)
}
</script>
