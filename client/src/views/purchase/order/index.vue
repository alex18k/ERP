<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { purchaseApi } from '../../../api'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import { createEmptyCondition, serializeConditions, type QueryCondition, type QueryField } from '../../../utils/queryBuilder'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const router = useRouter()
const query = reactive({ page: 1, pageSize: 20, conditions: undefined as string | undefined })

// ===== 高级查询 =====
const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])

const queryFields: QueryField[] = [
  { field: 'orderNo', label: '采购单号', type: 'text', placeholder: '采购单号' },
  { field: 'supplierName', label: '供应商', type: 'text', placeholder: '供应商名称' },
  {
    field: 'status',
    label: '单据状态',
    type: 'enum',
    options: [
      { label: '草稿', value: 'draft' },
      { label: '已确认', value: 'confirmed' },
    ],
  },
  { field: 'orderDate', label: '订货日期', type: 'date' },
  { field: 'expectedDate', label: '期望到货日期', type: 'date' },
  { field: 'buyer', label: '采购员', type: 'text', placeholder: '采购员' },
  { field: 'settleMethod', label: '结算方式', type: 'text', placeholder: '结算方式' },
  { field: 'totalAmount', label: '订单金额', type: 'number' },
  { field: 'materialCode', label: '物料编码', type: 'text', placeholder: '物料编码' },
  { field: 'materialName', label: '物料名称', type: 'text', placeholder: '物料名称' },
  { field: 'specification', label: '型号规格', type: 'text', placeholder: '型号规格' },
  { field: 'line', label: '行号', type: 'number' },
  { field: 'quantity', label: '订购数量', type: 'number' },
  { field: 'receivedQty', label: '已收数量', type: 'number' },
  { field: 'unitPrice', label: '单价', type: 'number' },
  { field: 'itemRemark', label: '明细备注', type: 'text', placeholder: '明细备注' },
  { field: 'remark', label: '表头备注', type: 'text', placeholder: '表头备注' },
  { field: 'createdAt', label: '创建日期', type: 'date' },
]

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'warning' },
  { label: '已确认', value: 'confirmed', type: 'success' },
]

// 明细行状态（采购单状态列取明细行）：空白(可收货/参与MRP)、关闭、取消
const itemStatusOptions = [
  { label: '空白', value: '', type: 'info' },
  { label: '关闭', value: 'closed', type: 'warning' },
  { label: '取消', value: 'cancelled', type: 'danger' },
]

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

// 明细级查询字段（后端按 items.some 过滤订单，前端再据此过滤平铺行）
const ITEM_FIELDS = new Set(['materialCode', 'materialName', 'specification', 'line', 'quantity', 'receivedQty', 'unitPrice', 'itemRemark'])

function submitAdvanced(conditions: QueryCondition[]) {
  query.conditions = serializeConditions(conditions)
  activeConditions.value = conditions.filter((c) => c.field && c.value !== null && c.value !== '' && c.value !== undefined)
  query.page = 1
  loadData()
}

function resetAdvanced() {
  advancedConditions.value = [createEmptyCondition()]
  activeConditions.value = []
  query.conditions = undefined
  query.page = 1
  loadData()
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

// 平铺明细行：每行 = 一个采购明细；明细级查询条件只保留匹配的明细行
const activeConditions = ref<QueryCondition[]>([])

function matchCondition(row: any, condition: QueryCondition): boolean {
  const v = condition.value
  const v2 = condition.value2
  switch (condition.field) {
    case 'materialCode': return String(row.materialCode ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'materialName': return String(row.materialName ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'specification': return String(row.specification ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'itemRemark': return String(row.itemRemark ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'line': return Number(row.line) === Number(v)
    case 'quantity': return compareNumber(Number(row.quantity), condition.operator, Number(v), Number(v2))
    case 'receivedQty': return compareNumber(Number(row.receivedQty), condition.operator, Number(v), Number(v2))
    case 'unitPrice': return compareNumber(Number(row.unitPrice), condition.operator, Number(v), Number(v2))
    default: return true
  }
}

function compareNumber(num: number, operator: string, v: any, v2: any): boolean {
  if (operator === 'gt') return num > v
  if (operator === 'lt') return num < v
  if (operator === 'range') {
    const lo = Math.min(Number(v), Number(v2))
    const hi = Math.max(Number(v), Number(v2))
    return num >= lo && num <= hi
  }
  return num === v
}

const rows = computed(() => {
  const itemConditions = activeConditions.value.filter((c) => ITEM_FIELDS.has(c.field))
  const out: any[] = []

  for (const o of list.value) {
    for (const it of (o.items || [])) {
      const m = it.material
      const row = {
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
        itemRemark: it.remark,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        returnedQty: it.returnedQty ?? 0,
        unitPrice: it.unitPrice,
        taxIncluded: it.taxIncluded ?? o.taxIncluded,
        taxRate: it.taxRate ?? o.taxRate,
        amount: it.amount,
        expectedDate: it.expectedDate,
        sourceOrderNo: it.sourceOrderNo,
      }
      if (itemConditions.length && !itemConditions.every((c) => matchCondition(row, c))) continue
      out.push(row)
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
// 草稿采购单整行高亮，便于和已确认单据区分
function rowClassName({ row }: any) {
  return row.confirmStatus === 'draft' ? 'row-draft' : ''
}

function receivedClass(row: any) {
  const q = Number(row.quantity) || 0
  const r = Number(row.receivedQty) || 0
  if (r <= 0) return 'qty-zero'
  if (q > 0 && r >= q) return 'qty-full'
  return 'qty-partial'
}

onMounted(async () => {
  loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="advanced-actions">
        <el-button type="primary" plain @click="handleToolbarEdit" :disabled="!currentRow"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button type="warning" plain @click="handleToolbarPrint" :disabled="!currentRow"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button type="success" plain class="btn-add" @click="router.push('/purchase/maintain')"><el-icon><Plus /></el-icon>新增采购单</el-button>
      </div>

      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 260px)" highlight-current-row :row-class-name="rowClassName" @current-change="onCurrentChange">
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
            <div class="empty-tip">可调整上方查询条件后重试；一行 = 一条采购明细</div>
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
.advanced-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.advanced-actions .btn-add {
  margin-left: auto;
}
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
/* 草稿采购单整行浅橙色标识 */
:deep(.el-table__row.row-draft > td.el-table__cell) {
  background-color: #fff7e6 !important;
}
:deep(.el-table__row.row-draft:hover > td.el-table__cell) {
  background-color: #ffefd1 !important;
}
:deep(.el-table__row.row-draft > td.el-table__cell:first-child) {
  box-shadow: inset 3px 0 0 var(--el-color-warning);
}
/* 选中行仍使用 Element Plus 的当前行颜色 */
:deep(.el-table__row.row-draft.current-row > td.el-table__cell) {
  background-color: var(--el-color-primary-light-9) !important;
}
</style>