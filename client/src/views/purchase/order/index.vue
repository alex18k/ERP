<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { purchaseApi, supplierApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const router = useRouter()
const query = reactive({ page: 1, pageSize: 20, orderNo: '', supplierId: '', status: '', materialKeyword: '' })

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'warning' },
]

// 明细行状态（采购单状态列取明细行）：空白(可收货/参与MRP)、关闭、取消
const itemStatusOptions = [
  { label: '空白', value: '', type: 'info' },
  { label: '关闭', value: 'closed', type: 'warning' },
  { label: '取消', value: 'cancelled', type: 'danger' },
]

const suppliers = ref<any[]>([])

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function itemStatusLabel(s: string) {
  return itemStatusOptions.find(o => o.value === (s || ''))?.label || (s || '空白')
}
function itemStatusType(s: string) {
  return itemStatusOptions.find(o => o.value === (s || ''))?.type || 'info'
}
// 单据确认状态（表头）
function confirmLabel(s: string) {
  return statusOptions.find(o => o.value === s)?.label || s
}
function confirmType(s: string) {
  return statusOptions.find(o => o.value === s)?.type || 'info'
}

// 平铺明细行：每行 = 一个采购明细；有物料关键词时只保留匹配的明细行
const rows = computed(() => {
  const keyword = (query.materialKeyword || '').trim()
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      const m = it.material
      if (keyword && m) {
        const hit = [m.code, m.name, m.specification].some((v) => v && String(v).toLowerCase().includes(keyword.toLowerCase()))
        if (!hit) continue
      }
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        settleMethod: o.settleMethod,
        buyer: o.buyer,
        confirmStatus: o.status,
        status: it.status || '',
        orderDate: o.orderDate,
        line: it.line || 0,
        materialCode: m?.code,
        materialName: m?.name,
        specification: m?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        returnedQty: it.returnedQty ?? 0,
        unitPrice: it.unitPrice,
        taxIncluded: it.taxIncluded ?? o.taxIncluded,
        taxRate: it.taxRate ?? o.taxRate,
        amount: it.amount,
        expectedDate: it.expectedDate,
        sourceOrderNo: it.sourceOrderNo,
      })
    }
  }
  return out
})

function editOrder(orderId: number) {
  router.push(`/purchase/maintain?id=${orderId}`)
}

// 工具栏的编辑/打印作用于当前选中行（highlight-current-row 单选）
const currentRow = ref<any | null>(null)
function onCurrentChange(row: any | null) {
  currentRow.value = row
}
function handleToolbarEdit() {
  if (!currentRow.value) { ElMessage.warning('请先在表格中选择一行'); return }
  editOrder(currentRow.value.orderId)
}
function handleToolbarPrint() {
  if (!currentRow.value) { ElMessage.warning('请先在表格中选择一行'); return }
  router.push(`/purchase/print?id=${currentRow.value.orderId}`)
}

function fmtPrice(v: any) {
  const n = Number(v)
  return n ? String(n) : ''
}

function netPrice(row: any) {
  if (row.unitPrice == null || row.unitPrice === '') return '-'
  const price = Number(row.unitPrice)
  if (!Number.isFinite(price)) return '-'
  const rate = Number(row.taxRate) || 0
  const net = row.taxIncluded && rate > 0 ? price / (1 + rate / 100) : price
  return net.toFixed(6)
}

// 已收量配色：未收灰色、部分收货橙色、已收满绿色
function receivedClass(row: any) {
  const q = Number(row.quantity) || 0
  const r = Number(row.receivedQty) || 0
  if (r <= 0) return 'qty-zero'
  if (q > 0 && r >= q) return 'qty-full'
  return 'qty-partial'
}

onMounted(async () => {
  loadData()
  try {
    const res: any = await supplierApi.list({ pageSize: 200 })
    suppliers.value = res.data.items
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.supplierId" placeholder="供应商" clearable filterable style="width: 180px">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-select v-model="query.status" placeholder="单据状态" clearable style="width: 120px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 200px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', supplierId: '', status: '', materialKeyword: '', page: 1 }), loadData()">重置</el-button>
        <el-button type="primary" plain style="margin-left: auto" @click="handleToolbarEdit" :disabled="!currentRow"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button type="warning" plain @click="handleToolbarPrint" :disabled="!currentRow"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button type="success" plain class="btn-add" @click="router.push('/purchase/maintain')"><el-icon><Plus /></el-icon>新增采购单</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 260px)" highlight-current-row @current-change="onCurrentChange">
        <el-table-column prop="orderNo" label="采购单号" width="120" />
        <el-table-column prop="line" label="行号" width="60" align="center" />
        <el-table-column prop="supplierName" label="供应商" min-width="200" show-overflow-tooltip />
        <el-table-column prop="buyer" label="采购员" width="80" />
        <el-table-column label="订货日期" width="110">
          <template #default="{ row }">{{ row.orderDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="settleMethod" label="结算方式" width="100" />
        <el-table-column prop="materialCode" label="物料编码" width="110" />
        <el-table-column prop="materialName" label="物料名称" min-width="150" />
        <el-table-column prop="specification" label="型号规格" min-width="140" />
        <el-table-column prop="quantity" label="数量" width="90" align="right" />
        <el-table-column label="已收" width="80" align="right">
          <template #default="{ row }">
            <span :class="receivedClass(row)">{{ row.receivedQty ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="退货" width="80">
          <template #default="{ row }">
            <span :class="{ 'qty-return': Number(row.returnedQty) > 0 }">{{ row.returnedQty ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="80" align="right">
          <template #default="{ row }">{{ fmtPrice(row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="不含税单价" width="120" align="right">
          <template #default="{ row }">{{ netPrice(row) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">¥{{ (row.amount ?? (row.quantity * (row.unitPrice || 0))).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110">
          <template #default="{ row }">{{ row.expectedDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="sourceOrderNo" label="订单号" width="140" />
        <el-table-column label="确认" width="100">
          <template #default="{ row }">
            <el-tag :type="confirmType(row.confirmStatus)" size="small">{{ confirmLabel(row.confirmStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="itemStatusType(row.status)" size="small">{{ itemStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的采购订单" :image-size="56">
            <div class="empty-tip">可清空采购单号/供应商/状态后重试；一行 = 一条采购明细</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap" style="justify-content: space-between">
        <el-button @click="purchaseApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

  </div>
</template>

<style scoped>
.qty-zero {
  color: var(--el-text-color-placeholder);
}
.qty-partial {
  color: var(--el-color-warning);
  font-weight: 600;
}
.qty-full {
  color: var(--el-color-success);
  font-weight: 600;
}
.qty-return {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>