<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { stockApi } from '../../../api'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import { createEmptyCondition, serializeConditions, type QueryCondition, type QueryField } from '../../../utils/queryBuilder'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive<{ page: number; pageSize: number; conditions?: string }>({ page: 1, pageSize: 20 })

const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])

const queryFields: QueryField[] = [
  { field: 'materialCode', label: '物料编码', type: 'text', placeholder: '物料编码' },
  { field: 'materialName', label: '物料名称', type: 'text', placeholder: '物料名称' },
  { field: 'specification', label: '型号规格', type: 'text', placeholder: '型号规格' },
  {
    field: 'category',
    label: '类别',
    type: 'enum',
    options: [
      { label: '采购', value: 'purchase' },
      { label: '制造', value: 'manufacture' },
    ],
  },
  { field: 'warehouseName', label: '仓库', type: 'text', placeholder: '仓库名称' },
  { field: 'quantity', label: '现存量', type: 'number' },
  { field: 'availableQty', label: '可用量', type: 'number' },
  { field: 'unit', label: '单位', type: 'text', placeholder: '单位' },
  { field: 'safetyStock', label: '安全库存', type: 'number' },
  {
    field: 'status',
    label: '状态',
    type: 'enum',
    options: [
      { label: '低于安全库存', value: 'low' },
      { label: '正常', value: 'normal' },
    ],
  },
]

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.detail(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function submitAdvanced(conditions: QueryCondition[]) {
  query.conditions = serializeConditions(conditions)
  query.page = 1
  loadData()
}

function resetAdvanced() {
  advancedConditions.value = [createEmptyCondition()]
  query.conditions = undefined
  query.page = 1
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">库存明细台账</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="stockApi.exportCsv(query)"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="物料编码" width="110">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="150">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="140">
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="类别" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ materialCategoryLabel(row.material?.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="130">
          <template #default="{ row }">{{ row.bin ? `${row.bin.code} - ${row.bin.name}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="170">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="批内数量" width="100" align="right">
          <template #default="{ row }">{{ row.batchQty ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="reservedQty" label="预占量" width="90" align="right" />
        <el-table-column label="可用量" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'txt-danger': row.isLow }">{{ row.availableQty }}</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有匹配的库存记录" :image-size="56">
            <div class="empty-tip">仅显示库存数量大于 0 的批号行/未分批余量行，可放宽物料或仓库筛选后重试</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.advanced-query {
  margin: 4px 0 8px;
  padding: 8px 10px;
  border: 1px solid #d5dae2;
  border-radius: 6px;
  background: #fafbfc;
}
</style>