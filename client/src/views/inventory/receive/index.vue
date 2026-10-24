<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, warehouseApi, warehouseBinApi, stockApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

const warehouses = ref<any[]>([])
const receiveVisible = ref(false)
const receiving = ref(false)
const currentOrder = ref<any>(null)
const receiveItems = ref<any[]>([])
const receiveForm = reactive({ effectiveDate: '', deliveryNo: '', keeper: '', remark: '' })
const keeperOptions = ref<string[]>([])
const binMap = reactive<Record<number, any[]>>({})

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))

function warehouseBinManaged(warehouseId: number | null) {
  return !!warehouseId && warehouses.value.find((w: any) => w.id === warehouseId)?.binManaged === true
}

function binOptionsFor(warehouseId: number | null) {
  return warehouseId ? binMap[warehouseId] || [] : []
}

async function loadKeeperOptions() {
  try {
    const res: any = await purchaseApi.receiptKeepers()
    keeperOptions.value = res.data || []
  } catch { /* ignore */ }
}

// 批号候选：该物料×仓库×货位现有批次（含余量），打开下拉时按需加载；
// 批号管理物料留空由后端自动生成，非批号管理物料可选/输入（填了即记批次行）。
async function loadRowBatches(row: any) {
  if (!row.materialId || !row.warehouseId) {
    row.batchOptions = []
    return
  }
  try {
    const scopeBin = warehouseBinManaged(row.warehouseId) && !row.binId ? "none" : row.binId || undefined
    const r: any = await stockApi.batches({ materialId: row.materialId, warehouseId: row.warehouseId, binId: scopeBin, pageSize: 200 })
    row.batchOptions = r.data.items || []
  } catch {
    row.batchOptions = []
  }
}

async function onLineWarehouseChange(row: any) {
  row.binId = null
  await loadRowBatches(row)
  if (!row.warehouseId || !warehouseBinManaged(row.warehouseId)) return
  if (!binMap[row.warehouseId]) {
    const res: any = await warehouseBinApi.list({ warehouseId: row.warehouseId, status: 1, pageSize: 200 })
    binMap[row.warehouseId] = res.data.items
  }
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 平铺明细行：每行 = 一个采购明细
const NON_RECEIVABLE = ['cancelled', 'closed']

// 明细状态：空白状态计入收货/MRP，进度由 receivedQty 推断
function itemState(it: any) {
  if (it.status === 'cancelled') return { key: 'cancelled', label: '已取消', type: 'info' }
  if (it.status === 'closed') return { key: 'closed', label: '已关闭', type: 'info' }
  const remaining = it.quantity - (it.receivedQty ?? 0)
  if (remaining <= 0) return { key: 'received', label: '已收货', type: 'success' }
  if ((it.receivedQty ?? 0) > 0) return { key: 'partial_received', label: '部分收货', type: 'warning' }
  return { key: 'pending', label: '待收货', type: 'success' }
}

const rows = computed(() => {
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      const remaining = it.quantity - (it.receivedQty ?? 0)
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        status: o.status,
        expectedDate: o.expectedDate ? String(o.expectedDate).slice(0, 10) : '',
        itemState: itemState(it),
        receivable: !NON_RECEIVABLE.includes(it.status) && remaining > 0,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        remaining,
        unitPrice: it.unitPrice,
      })
    }
  }
  return out
})

// 预计到货信息编码：逾期红色、今日琥珀色
function dueClass(row: any) {
  if (!row.receivable || !row.expectedDate) return ''
  if (row.expectedDate < todayStr()) return 'due-overdue'
  if (row.expectedDate === todayStr()) return 'due-today'
  return ''
}

const pendingRows = computed(() => rows.value.filter((r) => r.receivable).length)
const overdueRows = computed(() => rows.value.filter((r) => dueClass(r) === 'due-overdue').length)

const receiveLines = computed(() => receiveItems.value.filter((it) => Number(it.receiveQty) > 0))
const receiveTotalQty = computed(() => receiveLines.value.reduce((s, it) => s + Number(it.receiveQty || 0), 0))

// 勾选行的即时反馈：淡蓝底标识"本次将提交的行"
function receiveRowClass({ row }: any) {
  return Number(row.receiveQty) > 0 ? 'row-shipping' : ''
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list({ ...query, receivable: true })
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function statusLabel(s: string) {
  return { confirmed: '已确认', partial_received: '部分收货', received: '已收货', draft: '草稿', cancelled: '已取消', closed: '已关闭' }[s] || s
}
function statusType(s: string) {
  return { confirmed: 'primary', partial_received: 'warning', received: 'success', draft: 'info', cancelled: 'danger', closed: 'info' }[s] || 'primary'
}

function openReceiveByOrder(orderId: number) {
  const order = list.value.find((o) => o.id === orderId)
  if (order) openReceive(order)
}

async function openReceive(row: any) {
  currentOrder.value = row
  receiveItems.value = (row.items || [])
    .filter((it: any) => !NON_RECEIVABLE.includes(it.status) && (it.quantity - (it.receivedQty ?? 0)) > 0)
    .map((it: any) => {
      const location = it.location || it.material?.location || ''
      return {
        itemId: it.id,
        status: it.status,
        materialId: it.materialId ?? it.material?.id,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        unit: it.unit || it.material?.unit,
        batchManaged: it.material?.batchManaged === true,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        remaining: it.quantity - (it.receivedQty ?? 0),
        location,
        warehouseId: warehouseIdByLocation(activeWarehouses.value, location),
        binId: null,
        receiveQty: 0,
        batchNo: '',
        batchOptions: [],
      }
    })
  receiveForm.effectiveDate = todayStr()
  receiveForm.deliveryNo = ''
  receiveForm.keeper = ''
  receiveForm.remark = ''
  receiveVisible.value = true
  await Promise.all([
    ...receiveItems.value.map((l) => onLineWarehouseChange(l)),
    loadKeeperOptions(),
  ])
}

const hasReceiveQty = computed(() => receiveItems.value.some((it) => (it.receiveQty || 0) > 0))

function toggleFillQty() {
  if (hasReceiveQty.value) {
    receiveItems.value.forEach((it) => {
      it.receiveQty = 0
    })
  } else {
    receiveItems.value.forEach((it) => {
      it.receiveQty = it.remaining
    })
  }
}

async function submitReceive(): Promise<boolean> {
  const lines = receiveItems.value.filter((it) => it.receiveQty > 0)
  if (lines.length === 0) {
    ElMessage.warning('请填写收货数量')
    return false
  }
  const over = lines.find((it) => it.receiveQty > it.remaining)
  if (over) {
    ElMessage.warning(`${over.materialCode} 收货数量不能超过未收数量 ${over.remaining}`)
    return false
  }
  for (const it of lines) {
    if (!it.warehouseId) {
      ElMessage.warning(`${it.materialCode} 请选择库位`)
      return false
    }
  }
  const items = lines.map((it) => ({
    itemId: it.itemId,
    quantity: it.receiveQty,
    batchNo: it.batchNo || undefined,
    warehouseId: it.warehouseId,
    binId: it.binId || undefined,
  }))
  receiving.value = true
  try {
    const res: any = await purchaseApi.receive(currentOrder.value.id, {
      items,
      effectiveDate: receiveForm.effectiveDate || undefined,
      deliveryNo: receiveForm.deliveryNo || undefined,
      keeper: receiveForm.keeper || undefined,
      remark: receiveForm.remark || undefined,
    })
    const receiptNo = res.data?.receiptNo
    ElMessage.success(receiptNo ? `收货已提交，收货单号 ${receiptNo}` : '收货已提交')
    loadData()
    return true
  } catch {
    /* error shown */
    return false
  } finally {
    receiving.value = false
  }
}

async function confirmReceive() {
  const items = receiveItems.value.filter((it) => (it.receiveQty || 0) > 0)
  if (items.length === 0) {
    ElMessage.warning('请填写收货数量')
    return
  }
  const totalQty = items.reduce((sum, it) => sum + (it.receiveQty || 0), 0)
  try {
    await ElMessageBox.confirm(
      `本次将提交 ${items.length} 个物料收货，合计数量 ${totalQty}，提交后库存将增加且不可撤销，是否继续？`,
      '提交收货',
      { type: 'warning', confirmButtonText: '提交收货', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (await submitReceive()) receiveVisible.value = false
}

// 离开前检查是否有未保存的收货数量：有则询问是否保存
function confirmLeave(done?: () => void) {
  const close = () => {
    if (done) done()
    else receiveVisible.value = false
  }
  const hasQty = receiveItems.value.some((it) => (it.receiveQty || 0) > 0)
  if (!hasQty) {
    close()
    return
  }
  ElMessageBox.confirm('当前已填写收货数量，是否保存后关闭？', '未保存的收货', {
    confirmButtonText: '保存',
    cancelButtonText: '不保存',
    distinguishCancelAndClose: true,
    type: 'warning',
  })
    .then(async () => {
      if (await submitReceive()) close()
    })
    .catch((action: string) => {
      if (action === 'cancel') close()
    })
}

onMounted(async () => {
  const wRes: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = wRes.data.items
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">采购收货（按采购单入库）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="list-summary">
        <span>可收货采购单 <b>{{ total }}</b> 张</span>
        <span v-if="rows.length">· 本页待收行 <b>{{ pendingRows }}</b> 行</span>
        <span v-if="overdueRows">· <b class="due-overdue">{{ overdueRows }}</b> 行已过预计到货日期</span>
        <span class="list-summary-tip">仅显示已确认、且存在未收完明细（状态空白）的采购单；一行 = 一个采购明细</span>
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 300px)">
        <el-table-column prop="orderNo" label="采购单号" width="150" />
        <el-table-column prop="supplierName" label="供应商" min-width="180" show-overflow-tooltip />
        <el-table-column prop="materialCode" label="物料编码" width="120" show-overflow-tooltip />
        <el-table-column prop="materialName" label="物料名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="specification" label="规格型号" min-width="140" show-overflow-tooltip />
        <el-table-column label="预计到货" width="110">
          <template #default="{ row }">
            <span v-if="row.expectedDate" :class="dueClass(row)">{{ row.expectedDate }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="采购数量" width="90" align="right" />
        <el-table-column prop="receivedQty" label="已收" width="80" align="right" />
        <el-table-column label="未收" width="80" align="right">
          <template #default="{ row }">
            <b :class="{ 'due-today': row.receivable }">{{ row.remaining }}</b>
          </template>
        </el-table-column>
        <el-table-column prop="unitPrice" label="单价" width="90" align="right" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small" effect="light">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="明细状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.itemState.type" size="small" effect="light">{{ row.itemState.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="!row.receivable" @click="openReceiveByOrder(row.orderId)">收货</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有待收货的采购单" :image-size="56">
            <div class="empty-tip">采购单需为已确认，且存在状态空白、未收完的明细行</div>
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
      </div>
    </div>

    <!-- 收货弹窗 -->
    <el-dialog v-model="receiveVisible" :title="`采购收货 - ${currentOrder?.orderNo || ''}`" width="1200px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false" :before-close="confirmLeave">
      <div class="ship-head">
        <div class="ship-meta">
          <span class="ship-cust">{{ currentOrder?.supplier?.name || '未指定' }}</span>
          <el-tag size="small" effect="light" :type="statusType(currentOrder?.status)">{{ statusLabel(currentOrder?.status) }}</el-tag>
          <span class="ship-sub">预计到货 {{ currentOrder?.expectedDate ? String(currentOrder.expectedDate).slice(0, 10) : '-' }}</span>
        </div>
        <div class="ship-form">
          <div class="ship-grid recv-grid">
            <div class="ship-field">
              <label class="ship-label required">生效日期</label>
              <el-date-picker v-model="receiveForm.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="选择日期" style="width: 100%" />
            </div>
            <div class="ship-field">
              <label class="ship-label">送货单号</label>
              <el-input v-model="receiveForm.deliveryNo" clearable placeholder="供应商送货单号" size="small" />
            </div>
            <div class="ship-field">
              <label class="ship-label">仓管员</label>
              <el-select v-model="receiveForm.keeper" filterable clearable allow-create default-first-option placeholder="选择或输入仓管员" size="small">
                <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
              </el-select>
            </div>
            <div class="ship-field">
              <label class="ship-label">备注</label>
              <el-input v-model="receiveForm.remark" clearable placeholder="备注" size="small" />
            </div>
            <div class="ship-field ship-field-btn">
              <el-button size="small" @click="toggleFillQty">{{ hasReceiveQty ? '清空数量' : '填充未收数量' }}</el-button>
            </div>
          </div>
        </div>
      </div>

      <el-table class="ship-items" :data="receiveItems" size="small" stripe max-height="356px" :row-class-name="receiveRowClass">
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <div>{{ row.materialCode }} - {{ row.materialName }}</div>
            <span v-if="row.specification" class="ship-spec">{{ row.specification }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="60" />
        <el-table-column prop="quantity" label="采购数量" width="90" align="right" />
        <el-table-column prop="receivedQty" label="已收" width="70" align="right" />
        <el-table-column label="未收" width="70" align="right">
          <template #default="{ row }">{{ row.remaining }}</template>
        </el-table-column>
        <el-table-column label="本次收货" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.receiveQty" class="receive-qty" :min="0" :max="row.remaining" :precision="2" :controls="false" size="small" style="width: 100%" @dblclick="row.receiveQty = row.remaining" />
          </template>
        </el-table-column>
        <el-table-column label="库位" width="150">
          <template #default="{ row }">
            <el-select v-model="row.warehouseId" size="small" filterable placeholder="选择库位" style="width: 100%" @change="onLineWarehouseChange(row)">
              <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="货位" width="130">
          <template #default="{ row }">
            <el-select v-if="warehouseBinManaged(row.warehouseId)" v-model="row.binId" size="small" filterable clearable placeholder="选择货位" style="width: 100%" @change="loadRowBatches(row)">
              <el-option v-for="b in binOptionsFor(row.warehouseId)" :key="b.id" :label="b.name" :value="b.id" />
            </el-select>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="165">
          <template #default="{ row }">
            <el-select
              v-model="row.batchNo"
              size="small"
              filterable
              clearable
              allow-create
              default-first-option
              :placeholder="row.batchManaged ? '留空自动生成，或选择批号' : '可选：选择或输入批号'"
              style="width: 100%"
              @visible-change="(v: boolean) => v && loadRowBatches(row)"
            >
              <el-option v-for="b in row.batchOptions" :key="b.batchNo" :label="`${b.batchNo}（存 ${b.quantity}）`" :value="b.batchNo" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <div class="ship-footer">
          <span class="ship-summary">
            本次收货 <b>{{ receiveLines.length }}</b> 行 · 合计数量 <b>{{ receiveTotalQty }}</b>
          </span>
          <div>
            <el-button @click="confirmLeave()">关闭</el-button>
            <el-button type="primary" :loading="receiving" @click="confirmReceive">提交收货</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.list-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--erp-inktext);
  padding: 2px 0 8px;
}
.list-summary b {
  color: var(--erp-ink);
  font-weight: 600;
}
.list-summary-tip {
  margin-left: auto;
  color: var(--erp-steel);
}
.due-overdue {
  color: var(--erp-red);
  font-weight: 600;
}
.due-today {
  color: var(--erp-amber);
  font-weight: 600;
}
.empty-tip {
  font-size: 12px;
  color: var(--erp-steel);
}

.ship-head {
  margin-bottom: 10px;
}
.ship-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.ship-cust {
  font-size: 14px;
  font-weight: 600;
  color: var(--erp-ink);
}
.ship-sub {
  font-size: 12px;
  color: var(--erp-inktext);
}
.ship-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
  gap: 0 12px;
  align-items: end;
}
.recv-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
}
.ship-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ship-field-btn {
  justify-content: flex-end;
}
.ship-label {
  font-size: 12px;
  color: var(--erp-inktext);
  line-height: 20px;
}
.ship-label.required::before {
  content: '*';
  color: var(--erp-red);
  margin-right: 2px;
}

.ship-items .ship-spec {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.ship-items :deep(.el-table__cell) {
  padding: 2px 0;
}
.ship-items :deep(.cell) {
  padding: 2px 4px;
}
/* 参照材料出库 items-editor：行内控件无边框，聚焦细描边 */
.ship-items :deep(.el-input__wrapper),
.ship-items :deep(.el-select__wrapper) {
  box-shadow: none;
  background: transparent;
  border-radius: 0;
  padding: 0 2px;
  min-height: 24px;
}
.ship-items :deep(.el-input__wrapper:hover),
.ship-items :deep(.el-select__wrapper:hover) {
  box-shadow: none;
}
.ship-items :deep(.el-input__wrapper.is-focus),
.ship-items :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--erp-copper) inset;
  background: var(--el-fill-color-blank);
}
.ship-items :deep(.el-input-number .el-input__inner) {
  text-align: right;
}
.ship-items :deep(.receive-qty .el-input__inner) {
  color: var(--erp-green);
}
/* 表头字段：金蝶式下划线，无方框 */
.ship-field :deep(.el-input__wrapper),
.ship-field :deep(.el-select__wrapper) {
  box-shadow: 0 1px 0 0 var(--erp-hairline);
  background: transparent;
  border-radius: 0;
}
.ship-field :deep(.el-input__wrapper:hover),
.ship-field :deep(.el-select__wrapper:hover) {
  box-shadow: 0 1px 0 0 var(--el-text-color-secondary);
}
.ship-field :deep(.el-input__wrapper.is-focus),
.ship-field :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 1px 0 0 var(--erp-copper);
  background: transparent;
}
.ship-items :deep(.row-shipping) td.el-table__cell {
  background: var(--el-color-primary-light-9);
}

.ship-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ship-summary {
  font-size: 13px;
  color: var(--erp-inktext);
}
.ship-summary b {
  color: var(--erp-primary);
  font-weight: 600;
}
</style>
