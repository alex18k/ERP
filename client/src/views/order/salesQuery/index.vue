<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { orderApi } from '../../../api'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import {
  createEmptyCondition,
  serializeConditions,
  validateConditions,
  type QueryCondition,
  type QueryField,
} from '../../../utils/queryBuilder'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive<{ page: number; pageSize: number; conditions?: string }>({ page: 1, pageSize: 20 })
const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])
const activeConditions = ref<QueryCondition[]>([])

const orderStatusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
  { label: '生产中', value: 'in_production', type: 'warning' },
  { label: '已完工', value: 'completed', type: 'success' },
  { label: '已发货', value: 'shipped', type: 'info' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

const itemStatusOptions = [
  { label: '待生产', value: 'pending', type: 'info' },
  { label: '生产中', value: 'in_production', type: 'warning' },
  { label: '已完工', value: 'completed', type: 'success' },
  { label: '已发货', value: 'shipped', type: 'primary' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

const queryFields: QueryField[] = [
  // 主表
  { field: 'orderNo', label: '销售单号', type: 'text' },
  { field: 'customerName', label: '客户名称', type: 'text' },
  { field: 'customerCode', label: '客户编码', type: 'text' },
  { field: 'contactPerson', label: '联系人', type: 'text' },
  { field: 'contactPhone', label: '联系电话', type: 'text' },
  { field: 'channel', label: '渠道', type: 'text' },
  { field: 'seller1', label: '销售员1', type: 'text' },
  { field: 'seller2', label: '销售员2', type: 'text' },
  { field: 'paymentMethod', label: '付款方式', type: 'text' },
  { field: 'status', label: '单据状态', type: 'enum', options: orderStatusOptions },
  { field: 'orderDate', label: '订货日期', type: 'date' },
  { field: 'deliveryDate', label: '交货日期', type: 'date' },
  { field: 'totalAmount', label: '订单金额', type: 'number' },
  { field: 'remark', label: '表头备注', type: 'text' },
  { field: 'createdAt', label: '创建日期', type: 'date' },
  // 明细行
  { field: 'line', label: '行号', type: 'number' },
  { field: 'materialCode', label: '物料编码', type: 'text' },
  { field: 'materialName', label: '物料名称', type: 'text' },
  { field: 'specification', label: '型号规格', type: 'text' },
  { field: 'unit', label: '单位', type: 'text' },
  { field: 'quantity', label: '数量', type: 'number' },
  { field: 'unitPrice', label: '单价', type: 'number' },
  { field: 'taxRate', label: '税率', type: 'number' },
  { field: 'amount', label: '行金额', type: 'number' },
  { field: 'deliveredQty', label: '已发货数量', type: 'number' },
  { field: 'itemDeliveryDate', label: '行交货日期', type: 'date' },
  { field: 'itemStatus', label: '行状态', type: 'enum', options: itemStatusOptions },
  { field: 'itemRemark', label: '行备注', type: 'text' },
]

async function loadData() {
  loading.value = true
  try {
    const res: any = await orderApi.list(query as any)
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
  activeConditions.value = result.normalized
  query.conditions = serializeConditions(result.normalized)
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

const ITEM_FIELDS = new Set([
  'line', 'materialCode', 'materialName', 'specification', 'unit', 'quantity', 'unitPrice',
  'taxRate', 'amount', 'deliveredQty', 'itemDeliveryDate', 'itemStatus', 'itemRemark',
])

function textMatch(value: any, cond: QueryCondition): boolean {
  const text = String(value ?? '').toLowerCase()
  const v = String(cond.value ?? '').toLowerCase()
  if (cond.operator === 'eq') return text === v
  if (cond.operator === 'ne') return text !== v
  return text.includes(v)
}

function numMatch(value: any, cond: QueryCondition): boolean {
  const num = Number(value ?? 0)
  const v = Number(cond.value)
  const v2 = Number(cond.value2)
  switch (cond.operator) {
    case 'ne': return num !== v
    case 'gt': return num > v
    case 'lt': return num < v
    case 'gte': return num >= v
    case 'lte': return num <= v
    case 'range': {
      const lo = Math.min(v, v2)
      const hi = Math.max(v, v2)
      return num >= lo && num <= hi
    }
    default: return num === v
  }
}

function dateMatch(value: any, cond: QueryCondition): boolean {
  const d = value ? String(value).slice(0, 10) : ''
  const v = String(cond.value ?? '').slice(0, 10)
  const v2 = String(cond.value2 ?? '').slice(0, 10)
  switch (cond.operator) {
    case 'ne': return !!d && d !== v
    case 'gt': return !!d && d > v
    case 'gte': return !!d && d >= v
    case 'lt': return !!d && d < v
    case 'lte': return !!d && d <= v
    case 'range': {
      const lo = v < v2 ? v : v2
      const hi = v < v2 ? v2 : v
      return !!d && d >= lo && d <= hi
    }
    default: return !!d && d === v
  }
}

/** 明细行是否命中当前明细条件（与后端 items.some 一致，用于逐行过滤） */
function itemMatches(item: any, conds: QueryCondition[]): boolean {
  return conds.every((c) => {
    switch (c.field) {
      case 'materialCode': return textMatch(item.material?.code, c)
      case 'materialName': return textMatch(item.material?.name, c)
      case 'specification': return textMatch(item.material?.specification, c)
      case 'unit': return textMatch(item.unit || item.material?.unit, c)
      case 'itemRemark': return textMatch(item.remark, c)
      case 'line': return numMatch(item.line, c)
      case 'quantity': return numMatch(item.quantity, c)
      case 'unitPrice': return numMatch(item.unitPrice, c)
      case 'taxRate': return numMatch(item.taxRate, c)
      case 'amount': return numMatch(item.amount, c)
      case 'deliveredQty': return numMatch(item.deliveredQty, c)
      case 'itemDeliveryDate': return dateMatch(item.deliveryDate, c)
      case 'itemStatus': return textMatch(item.status, c)
      default: return true
    }
  })
}

function toRow(o: any, it: any) {
  const m = it?.material
  return {
    orderId: o.id,
    orderNo: o.orderNo,
    customerName: o.customerName,
    customerCode: o.customerCode,
    contactPerson: o.contactPerson,
    contactPhone: o.contactPhone,
    channel: o.channel,
    seller1: o.seller1,
    seller2: o.seller2,
    paymentMethod: o.paymentMethod,
    status: o.status,
    orderDate: o.orderDate,
    deliveryDate: o.deliveryDate,
    totalAmount: o.totalAmount,
    remark: o.remark,
    createdAt: o.createdAt,
    line: it?.line,
    materialCode: m?.code,
    materialName: m?.name,
    specification: m?.specification,
    unit: it?.unit || m?.unit,
    quantity: it?.quantity,
    unitPrice: it?.unitPrice,
    taxRate: it?.taxRate,
    amount: it?.amount ?? (it ? Number(it.quantity) * Number(it.unitPrice || 0) : null),
    deliveredQty: it?.deliveredQty,
    itemDeliveryDate: it?.deliveryDate,
    itemStatus: it?.status,
    itemRemark: it?.remark,
  }
}

// 平铺：一行 = 一条销售明细；明细级条件只保留命中的明细行
const rows = computed(() => {
  const itemConds = activeConditions.value.filter((c) => ITEM_FIELDS.has(c.field))
  const out: any[] = []
  for (const o of list.value) {
    const items = (o.items || []).filter((it: any) => itemMatches(it, itemConds))
    if (!items.length) {
      if (!itemConds.length) out.push(toRow(o, null))
      continue
    }
    for (const it of items) out.push(toRow(o, it))
  }
  return out
})

function statusLabel(s: string) {
  return orderStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function statusType(s: string) {
  return orderStatusOptions.find((o) => o.value === s)?.type || 'info'
}
function itemStatusLabel(s: string) {
  return itemStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function itemStatusType(s: string) {
  return itemStatusOptions.find((o) => o.value === s)?.type || 'info'
}
function dateOnly(v: any) {
  return v ? String(v).slice(0, 10) : '-'
}
function fmtNumber(v: any, digits = 4) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return String(Number(n.toFixed(digits)))
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 230px)" highlight-current-row>
        <el-table-column label="订货日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="销售单号" width="146" show-overflow-tooltip />
        <el-table-column prop="line" label="行号" width="60" align="center" />
        <el-table-column prop="customerCode" label="客户编码" width="110" />
        <el-table-column prop="customerName" label="客户名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="materialCode" label="物料编码" width="110" />
        <el-table-column prop="materialName" label="物料名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="specification" label="型号规格" min-width="140" show-overflow-tooltip />
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column label="数量" width="90" align="right">
          <template #default="{ row }">{{ fmtNumber(row.quantity) }}</template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">{{ fmtNumber(row.unitPrice, 6) }}</template>
        </el-table-column>
        <el-table-column label="税率" width="80" align="right">
          <template #default="{ row }">{{ row.taxRate == null ? '-' : row.taxRate + '%' }}</template>
        </el-table-column>
        <el-table-column label="行金额" width="100" align="right">
          <template #default="{ row }">{{ fmtNumber(row.amount, 2) }}</template>
        </el-table-column>
        <el-table-column label="已发货数量" width="110" align="right">
          <template #default="{ row }">{{ fmtNumber(row.deliveredQty) }}</template>
        </el-table-column>
        <el-table-column label="行交货日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.itemDeliveryDate) }}</template>
        </el-table-column>
        <el-table-column prop="contactPerson" label="联系人" width="90" />
        <el-table-column prop="contactPhone" label="联系电话" width="120" />
        <el-table-column prop="channel" label="渠道" width="90" />
        <el-table-column prop="seller1" label="销售员1" width="90" />
        <el-table-column prop="seller2" label="销售员2" width="90" />
        <el-table-column prop="paymentMethod" label="付款方式" width="110" />
        <el-table-column label="单据状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交货日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.deliveryDate) }}</template>
        </el-table-column>
        <el-table-column label="订单金额" width="110" align="right">
          <template #default="{ row }">{{ fmtNumber(row.totalAmount, 2) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="表头备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="行状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.itemStatus" :type="itemStatusType(row.itemStatus)" size="small">{{ itemStatusLabel(row.itemStatus) }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="itemRemark" label="行备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="创建日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.createdAt) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的销售订单" :image-size="56">
            <div class="empty-tip">可调整上方查询条件后重试；一行 = 一条销售明细</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
        <div class="pagination-tip">共 {{ total }} 张订单，展开 {{ rows.length }} 行明细</div>
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
.pagination-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.pagination-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
