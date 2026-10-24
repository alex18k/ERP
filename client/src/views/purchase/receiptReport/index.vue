<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Printer } from '@element-plus/icons-vue'
import { purchaseApi } from '../../../api'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import { createEmptyCondition, serializeConditions, validateConditions, type QueryCondition, type QueryField } from '../../../utils/queryBuilder'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const query = reactive({ page: 1, pageSize: 20 })
const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])

const queryFields: QueryField[] = [
  { field: 'receiptNo', label: '收货单号', type: 'text' },
  { field: 'orderNo', label: '采购单号', type: 'text' },
  { field: 'materialKeyword', label: '物料编码/名称/规格', type: 'text' },
  { field: 'materialCode', label: '物料编码', type: 'text' },
  { field: 'materialName', label: '物料名称', type: 'text' },
  { field: 'specification', label: '型号规格', type: 'text' },
  { field: 'supplierName', label: '供应商', type: 'text' },
  { field: 'deliveryNo', label: '送货单号', type: 'text' },
  { field: 'batchNo', label: '批号', type: 'text' },
  { field: 'warehouseName', label: '仓库', type: 'text' },
  { field: 'location', label: '库位', type: 'text' },
  { field: 'binName', label: '货位', type: 'text' },
  { field: 'buyer', label: '采购员', type: 'text' },
  { field: 'settleMethod', label: '结算方式', type: 'text' },
  { field: 'operatorName', label: '操作员', type: 'text' },
  { field: 'startDate', label: '开始日期', type: 'date' },
  { field: 'endDate', label: '结束日期', type: 'date' },
]
async function loadData(extra: Record<string, any> = {}) {
  loading.value = true
  try {
    const res: any = await purchaseApi.receipts({ page: query.page, pageSize: query.pageSize, ...extra })
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function submitAdvanced(conditions: QueryCondition[]) {
  const result = validateConditions(conditions, queryFields)
  if (!result.ok) {
    ElMessage.warning(result.message || '查询条件有误')
    return
  }
  query.page = 1
  loadData({ conditions: serializeConditions(result.normalized) })
}

function resetAdvanced() {
  advancedConditions.value = [createEmptyCondition()]
  query.page = 1
  loadData()
}

function dateOnly(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : '-'
}

function handlePrint() {
  const receiptNo = currentRow.value?.receiptNo || currentRow.value?.documentNo
  if (!receiptNo) return
  router.push(`/purchase/receipt-print?receiptNo=${encodeURIComponent(receiptNo)}`)
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <div class="toolbar">
        <div style="flex: 1" />
        <el-button type="primary" plain :disabled="!currentRow?.receiptNo && !currentRow?.documentNo" @click="handlePrint"><el-icon><Printer /></el-icon>打印收货单</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="收货日期" width="90">
          <template #default="{ row }">{{ dateOnly(row.effectiveDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="收货单号" width="160">
          <template #default="{ row }">{{ row.receiptNo || row.documentNo }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="采购单号" width="120">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="lineNo" label="行号" width="70">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="supplierName" label="供应商" min-width="220">
          <template #default="{ row }">{{ row.supplierName || '未指定' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column :label="'收货/退货数量'" width="120" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.isReturn ? 'var(--el-color-danger)' : 'var(--el-color-success)', fontWeight: 600 }">
              {{ row.isReturn ? '-' : '+' }}{{ row.quantity }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="单价" width="110" align="right">
          <template #default="{ row }">{{ row.unitPrice != null ? Number(row.unitPrice).toFixed(6) : '-' }}</template>
        </el-table-column>
        <el-table-column label="不含税价" width="100" align="right">
          <template #default="{ row }">{{ row.priceExcludingTax != null ? Number(row.priceExcludingTax).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">{{ row.amount != null ? Number(row.amount).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="含税" width="70" align="center">
          <template #default="{ row }">{{ row.taxIncluded ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="税率" width="80" align="right">
          <template #default="{ row }">{{ row.taxRate != null ? `${row.taxRate}%` : '-' }}</template>
        </el-table-column>
        <el-table-column label="结算方式" width="120">
          <template #default="{ row }">{{ row.settleMethod || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购员" width="100">
          <template #default="{ row }">{{ row.buyer || '-' }}</template>
        </el-table-column>
        <el-table-column label="送货单号" width="120">
          <template #default="{ row }">{{ row.deliveryNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="160">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="location" label="库位" width="90">
          <template #default="{ row }">{{ row.location || '-' }}</template>
        </el-table-column>
        <el-table-column label="货位" width="120">
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="100">
          <template #default="{ row }">{{ row.operator?.realName || row.operator?.username || '-' }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的收货记录" :image-size="56">
            <div class="empty-tip">同时包含采购收货与退货流水；可清空单号/日期/物料条件后重试</div>
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
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
