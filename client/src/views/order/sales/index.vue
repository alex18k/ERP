<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', customerName: '', status: '' })
const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
  { label: '生产中', value: 'in_production', type: 'warning' },
  { label: '已完工', value: 'completed', type: 'success' },
  { label: '已发货', value: 'shipped', type: '' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

async function loadData() {
  loading.value = true
  try {
    const res: any = await orderApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function formatStatus(val: string) {
  return statusOptions.find(o => o.value === val)?.label || val
}

function statusType(val: string) {
  return statusOptions.find(o => o.value === val)?.type || 'info'
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 交期信息编码：未完工订单逾期红色、今日琥珀色
function dueDateOf(row: any): string {
  const d = row._lineDeliveryDate || row.deliveryDate
  return d ? String(d).slice(0, 10) : ''
}
function dueClass(row: any): string {
  if (['completed', 'shipped', 'cancelled'].includes(row.status)) return ''
  const d = dueDateOf(row)
  if (!d) return ''
  if (d < todayStr()) return 'due-overdue'
  if (d === todayStr()) return 'due-today'
  return ''
}


const cancelTitle = computed(() => {
  const parts: string[] = []
  if (cancelInfo.value?.plannedCount) parts.push(`${cancelInfo.value.plannedCount} 张未开工生产订单将整单取消`)
  if (cancelInfo.value?.inProgressCount) parts.push(`${cancelInfo.value.inProgressCount} 张加工中订单仅取消其 ${cancelInfo.value.pendingBatchCount} 个未开工批次`)
  return parts.join('；')
})

const cancelDialogVisible = ref(false)
const cancelTarget = ref<any>(null)
const cancelInfo = ref<any>(null)
const cancelWithProduction = ref(false)

async function openCancelDialog(row: any) {
  const res: any = await orderApi.downstream(row.id)
  cancelTarget.value = row
  cancelInfo.value = res.data
  cancelWithProduction.value = res.data.canCancelProduction
  cancelDialogVisible.value = true
}

async function confirmCancel() {
  try {
    await orderApi.cancel(cancelTarget.value.id, { cancelProduction: cancelWithProduction.value })
    ElMessage.success(cancelWithProduction.value && cancelInfo.value?.plannedCount > 0
      ? `订单已取消${cancelInfo.value.plannedCount ? `，${cancelInfo.value.plannedCount} 张未开工生产订单已取消` : ''}${cancelInfo.value.inProgressCount ? `，${cancelInfo.value.inProgressCount} 张加工中订单仅取消了未开工工单` : ''}`
      : '订单已取消')
    cancelDialogVisible.value = false
    loadData()
  } catch { /* canceled */ }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除已取消的销售订单 ${row.orderNo} ？仅允许删除没有排产、没有发运的订单。`,
      '删除销售订单',
      { type: 'warning' }
    )
    await orderApi.remove(row.id)
    ElMessage.success('销售订单已删除')
    loadData()
  } catch { /* canceled or error shown */ }
}

async function handleShip(row: any) {
  try {
    await ElMessageBox.confirm(`确认订单 ${row.orderNo} 已完成生产并安排发货？`, '发货确认', { type: 'warning' })
    await orderApi.ship(row.id)
    ElMessage.success('订单已发货')
    loadData()
  } catch { /* canceled */ }
}

onMounted(loadData)

const flatRows = computed(() =>
  list.value.flatMap((o: any) => {
    const rows = (o.items?.length ? o.items : [{}]).map((it: any) => ({ ...it, ...o, _first: false, _lineDeliveryDate: it.deliveryDate || null }))
    if (rows.length) rows[0]._first = true
    return rows
  }),
)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="订单编号" clearable style="width: 160px" />
        <el-input v-model="query.customerName" placeholder="客户名称" clearable style="width: 160px" />
        <el-select v-model="query.status" placeholder="订单状态" clearable style="width: 130px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', customerName: '', status: '', page: 1 }), loadData()">重置</el-button>
        <div style="flex: 1" />
        <el-button type="success" plain class="btn-add" @click="router.push('/order/maintain')"><el-icon><Plus /></el-icon>新增订单</el-button>
        <el-button @click="orderApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="flatRows" v-loading="loading" stripe max-height="calc(100vh - 300px)">
        <el-table-column label="行号" width="62" align="center">
          <template #default="{ row }">{{ row.line || '-' }}</template>
        </el-table-column>
        <el-table-column label="订单编号" width="150">
          <template #default="{ row }">
            <span v-if="row._first" style="font-variant-numeric: tabular-nums">{{ row.orderNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="客户" min-width="120">
          <template #default="{ row }">
            <span v-if="row._first">{{ row.customerName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <span v-if="row.material">{{ row.material.code }} - {{ row.material.name }}{{ (row.unit || row.material.unit) ? ` (${row.unit || row.material.unit})` : '' }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="90" align="right">
          <template #default="{ row }">{{ row.quantity ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="单价" width="100" align="right">
          <template #default="{ row }">{{ row.unitPrice != null ? `¥${row.unitPrice.toLocaleString()}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="行金额" width="110" align="right">
          <template #default="{ row }">{{ row.unitPrice != null && row.quantity ? `¥${(row.unitPrice * row.quantity).toLocaleString()}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="交期" width="110">
          <template #default="{ row }">
            <span :class="dueClass(row)">
              {{ (row._lineDeliveryDate || row.deliveryDate || '-').toString().slice(0, 10) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row._first" :type="statusType(row.status)">{{ formatStatus(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="router.push(`/order/print?id=${row.id}`)">打印</el-button>
            <el-button size="small" type="primary" link @click="router.push(`/order/tracking?id=${row.id}`)">跟踪</el-button>
            <el-button v-if="['draft','confirmed','in_production'].includes(row.status)" size="small" type="primary" link @click="router.push(`/order/maintain?id=${row.id}`)">编辑</el-button>
            <el-button v-if="row.status === 'completed'" size="small" type="primary" link @click="handleShip(row)">发货</el-button>
            <el-button v-if="['draft','confirmed','in_production'].includes(row.status)" size="small" type="danger" link @click="openCancelDialog(row)">取消</el-button>
            <el-button v-if="row._first && row.status === 'cancelled'" size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的销售订单" :image-size="56">
            <div class="empty-tip">可清空订单号/客户名称/状态后重试，或点右上角「新增订单」</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="cancelDialogVisible" :title="`取消订单 ${cancelTarget?.orderNo || ''}`" width="480px" destroy-on-close>
      <div style="line-height: 1.8">
        <div>订单将被标记为「已取消」，从 MRP 运算与统计中剔除。</div>
        <template v-if="cancelInfo?.canCancelProduction">
          <el-alert :title="cancelTitle" type="warning" :closable="false" style="margin: 12px 0" />
          <el-checkbox v-model="cancelWithProduction">取消未开工生产订单及未开工批次（加工中的订单保留）</el-checkbox>
        </template>
      </div>
      <template #footer>
        <el-button @click="cancelDialogVisible = false">放弃</el-button>
        <el-button type="danger" @click="confirmCancel">确认取消</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
.erp-group {
  border: 1px solid #D5DAE2;
  border-left: 3px solid var(--erp-primary);
  border-radius: 6px;
  padding: 8px 12px 2px;
  margin-bottom: 12px;
  background: #FAFBFC;
}
.erp-group-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

/* 金蝶表头：5 列网格，固定标签宽，列对齐、行距紧凑 */
.kd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  column-gap: 16px;
  row-gap: 2px;
}
.kd-field-span2 { grid-column: span 2; }
.kd-header-form .kd-grid :deep(.el-form-item) {
  margin-bottom: 6px;
  margin-right: 0;
  white-space: nowrap;
}
.kd-header-form .kd-grid :deep(.el-form-item__label) {
  line-height: 26px;
  height: 26px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.kd-header-form .kd-grid :deep(.el-form-item__content) {
  line-height: 26px;
  min-height: 26px;
  white-space: nowrap;
}
.kd-flex {
  width: 100%;
}
.kd-muted {
  color: var(--el-text-color-secondary);
}

/* 金蝶风格：表头输入控件无方框，仅底部下划线；聚焦时下划线变主题色 */
.erp-group :deep(.el-input__wrapper),
.erp-group :deep(.el-select__wrapper) {
  box-shadow: 0 1px 0 0 var(--erp-hairline);
  background: transparent;
  border-radius: 0;
  padding-left: 2px;
  padding-right: 2px;
  transition: box-shadow 0.2s;
}
.erp-group :deep(.el-input__wrapper:hover),
.erp-group :deep(.el-select__wrapper:hover) {
  box-shadow: 0 1px 0 0 var(--el-text-color-secondary);
}
.erp-group :deep(.el-input__wrapper.is-focus),
.erp-group :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 1px 0 0 var(--erp-copper);
  background: transparent;
}
.erp-group :deep(.el-select__caret),
.erp-group :deep(.el-input__icon) {
  color: var(--el-text-color-secondary);
}
.erp-group :deep(.el-input__wrapper.is-focus .el-input__icon),
.erp-group :deep(.el-select__wrapper.is-focused .el-select__caret) {
  color: var(--erp-copper);
}

/* 明细行控件无边框：平时像纯文本，悬停/聚焦显示细线 */
.items-editor :deep(.el-input__wrapper),
.items-editor :deep(.el-select__wrapper) {
  box-shadow: none;
  background: transparent;
  border-radius: 4px;
}
.items-editor :deep(.el-input__wrapper:hover),
.items-editor :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--erp-hairline) inset;
}
.items-editor :deep(.el-input__wrapper.is-focus),
.items-editor :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--erp-copper) inset;
  background: var(--el-fill-color-blank);
}
</style>