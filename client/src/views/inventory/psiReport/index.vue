<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { stockApi, warehouseApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const summary = ref<any>({})
const warehouses = ref<any[]>([])
const exportLoading = ref(false)

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const now = new Date()
const defaultStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1))
const defaultEnd = fmtDate(now)

const query = reactive({
  page: 1,
  pageSize: 20,
  startDate: defaultStart,
  endDate: defaultEnd,
  warehouseId: '',
  materialKeyword: '',
  category: '',
  showZero: false,
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.psiReport({ ...query, showZero: query.showZero ? 1 : 0 })
    list.value = res.data.items
    total.value = res.data.total
    summary.value = res.data.summary || {}
    query.startDate = res.data.startDate
    query.endDate = res.data.endDate
  } finally { loading.value = false }
}

function search() {
  query.page = 1
  loadData()
}

function reset() {
  Object.assign(query, {
    page: 1,
    startDate: defaultStart,
    endDate: defaultEnd,
    warehouseId: '',
    materialKeyword: '',
    category: '',
    showZero: false,
  })
  loadData()
}

async function exportCsv() {
  exportLoading.value = true
  try {
    await stockApi.exportPsiReport({ ...query, showZero: query.showZero ? 1 : 0 })
  } finally { exportLoading.value = false }
}

function fmtQty(v: any) {
  const n = Number(v) || 0
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
function fmtAmount(v: any) {
  return (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function summaryMethod() {
  const s = summary.value || {}
  return [
    '合计', '', '', '', '', '',
    fmtQty(s.openingQty), fmtAmount(s.openingAmount),
    fmtQty(s.inQty), fmtAmount(s.inAmount),
    fmtQty(s.outQty), fmtAmount(s.outAmount),
    fmtQty(s.closingQty), fmtAmount(s.closingAmount),
  ]
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

onMounted(() => {
  loadWarehouses()
  loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <fieldset class="group-box">
        <div class="search-bar group-inner">
          <el-input
            v-model="query.startDate"
            type="date"
            placeholder="开始"
            clearable
            style="width: 150px"
            @keyup.enter="search"
          />
          <el-input
            v-model="query.endDate"
            type="date"
            placeholder="结束"
            clearable
            style="width: 150px"
            @keyup.enter="search"
          />
          <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <el-input
            v-model="query.materialKeyword"
            placeholder="物料编码/名称/规格"
            clearable
            style="width: 200px"
            @keyup.enter="search"
          />
          <el-select v-model="query.category" placeholder="类别" clearable style="width: 110px">
            <el-option label="采购" value="purchase" />
            <el-option label="制造" value="manufacture" />
          </el-select>
          <el-checkbox v-model="query.showZero">显示零库存</el-checkbox>
          <el-button type="primary" @click="search"><el-icon><Search /></el-icon>查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </fieldset>

      <div class="table-toolbar">
        <span class="toolbar-title">进销存报表</span>
        <span class="range-tip">{{ query.startDate }} 至 {{ query.endDate }}</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button :loading="exportLoading" @click="exportCsv"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table
        :data="list"
        v-loading="loading"
        stripe
        max-height="calc(100vh - 280px)"
        show-summary
        :summary-method="summaryMethod"
      >
        <el-table-column prop="materialCode" label="物料编码" width="110" show-overflow-tooltip />
        <el-table-column prop="materialName" label="物料名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="specification" label="型号规格" min-width="140" show-overflow-tooltip />
        <el-table-column label="类别" width="70">
          <template #default="{ row }">{{ materialCategoryLabel(row.category) }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="64" />
        <el-table-column prop="warehouseName" label="仓库" width="100" show-overflow-tooltip />

        <el-table-column label="期初">
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">{{ fmtQty(row.openingQty) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ fmtAmount(row.openingAmount) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="本期入库">
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">{{ fmtQty(row.inQty) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ fmtAmount(row.inAmount) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="本期出库">
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">{{ fmtQty(row.outQty) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ fmtAmount(row.outAmount) }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="期末">
          <el-table-column label="数量" width="100" align="right">
            <template #default="{ row }">
              <span class="closing-qty">{{ fmtQty(row.closingQty) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ fmtAmount(row.closingAmount) }}</template>
          </el-table-column>
        </el-table-column>

        <template #empty>
          <el-empty description="所选期间没有符合条件的进销存数据" :image-size="56" />
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 条件区域分组框（无标题） */
.group-box {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 10px 12px;
  margin: 0 0 12px;
}
.group-inner {
  margin-bottom: 0 !important;
}
.range-tip {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.closing-qty {
  font-weight: 600;
}
</style>
