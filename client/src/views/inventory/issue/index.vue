<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi, stockApi } from '../../../api'
import { BASE_LOCATIONS, warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, orderNo: '', status: '' })

const statusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已关闭', value: 'closed', type: 'info' },
]

const dialogVisible = ref(false)
const submitting = ref(false)
const currentOrder = ref<any>(null)
const currentWorkOrder = ref<any>(null)
const detail = ref<any[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const form = reactive<any>({ warehouseId: null, issueQty: 0, effectiveDate: '' })
let workOrderReqSeq = 0

// 可用库存按「领料明细行库位」计算：行库位代码 → 仓库；货位管理仓库选了货位则取该货位结存
const stockTotals = ref<Map<string, number>>(new Map()) // `${warehouseId}|${materialId}` → 仓库结存合计
const stockByBin = ref<Map<string, number>>(new Map()) // `${warehouseId}|${materialId}|${binId}`
const binsByWarehouse = ref<Map<number, any[]>>(new Map())
const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const warehouseByCode = computed(() => new Map(activeWarehouses.value.map((w: any) => [w.code, w])))

function rowWarehouse(row: any) {
  if (row.location) return warehouseByCode.value.get(row.location) || null
  return selectedWarehouse.value
}
function rowWarehouseId(row: any) {
  return (rowWarehouse(row) as any)?.id ?? 0
}
function rowBinRequired(row: any) {
  return (rowWarehouse(row) as any)?.binManaged === true
}
const hasBinRows = computed(() => detail.value.some((l: any) => rowBinRequired(l)))
function rowBins(row: any) {
  return binsByWarehouse.value.get(rowWarehouseId(row)) || []
}

async function loadWarehouseBins(whId: number) {
  if (!whId || binsByWarehouse.value.has(whId)) return
  const wh = activeWarehouses.value.find((w: any) => w.id === whId)
  let list: any[] = []
  if (wh?.binManaged) {
    try {
      const res: any = await warehouseBinApi.list({ warehouseId: whId, status: 1, pageSize: 200 })
      list = res.data.items || []
    } catch {
      list = []
    }
  }
  const next = new Map(binsByWarehouse.value)
  next.set(whId, list)
  binsByWarehouse.value = next
}

// 顶部「库位」= 批量设置：把所有行的库位改成所选仓库，之后再按行微调
async function onWarehouseChange(warehouseId?: number | string) {
  const wh = warehouses.value.find((w: any) => w.id === Number(warehouseId ?? form.warehouseId)) || selectedWarehouse.value
  const code = wh?.code || ''
  for (const line of detail.value) {
    if (code) line.location = code
    line.binId = null
    line.batchNo = ''
    line.batches = []
    line.batchesKey = ''
  }
  await loadStocks()
}

async function onRowLocationChange(row: any) {
  row.binId = null
  row.batchNo = ''
  row.batches = []
  row.batchesKey = ''
  await loadWarehouseBins(rowWarehouseId(row))
}

// 按行库位批量取结存（一个仓库一次请求）
async function loadStocks() {
  stockTotals.value = new Map()
  stockByBin.value = new Map()
  const ids = [...new Set(detail.value.map((l: any) => Number(l.material?.id)).filter((n) => n > 0))]
  const whIds = [...new Set(detail.value.map((l: any) => rowWarehouseId(l)).filter((n) => n > 0))]
  if (ids.length === 0 || whIds.length === 0) return
  const totals = new Map<string, number>()
  const byBin = new Map<string, number>()
  await Promise.all(
    whIds.map(async (whId) => {
      try {
        const res: any = await stockApi.list({ warehouseId: whId, materialIds: ids.join(','), pageSize: 1000 })
        for (const st of res.data.items || []) {
          const mid = Number(st.materialId)
          const qty = Number(st.quantity) || 0
          const key = `${whId}|${mid}`
          totals.set(key, (totals.get(key) ?? 0) + qty)
          if (st.binId != null) {
            const bkey = `${whId}|${mid}|${st.binId}`
            byBin.set(bkey, (byBin.get(bkey) ?? 0) + qty)
          }
        }
      } catch {
        /* 库存读取失败不影响发料，按 0 展示 */
      }
    })
  )
  stockTotals.value = totals
  stockByBin.value = byBin
  await Promise.all(whIds.map((whId) => loadWarehouseBins(whId)))
}

function rowStock(row: any) {
  const mid = Number(row.material?.id)
  const whId = rowWarehouseId(row)
  if (!mid || !whId) return 0
  if (rowBinRequired(row) && row.binId != null) return stockByBin.value.get(`${whId}|${mid}|${row.binId}`) ?? 0
  return stockTotals.value.get(`${whId}|${mid}`) ?? 0
}

// 本次发放（折算基本单位）是否超过当前库存
function rowStockShort(row: any) {
  const rate = Number(row.material?.unitRates?.[row.issueUnit]) || 1
  const need = (Number(row.issueQty) || 0) * rate
  return need > 0 && rowStock(row) + 1e-6 < need
}

// 批号候选：该物料×行库位仓库×货位尚有结存的批次，打开下拉时按需加载
async function loadRowBatches(row: any) {
  const whId = rowWarehouseId(row)
  if (!whId || !row.material?.id) return
  const key = `${whId}|${row.binId ?? ''}`
  if (row.batchesKey === key) return
  row.batchesLoading = true
  try {
    const res: any = await stockApi.batches({ materialId: row.material.id, warehouseId: whId, binId: rowBinRequired(row) && !row.binId ? "none" : row.binId || undefined, pageSize: 200 })
    row.batches = res.data.items || []
    row.batchesKey = key
  } catch {
    row.batches = []
  } finally {
    row.batchesLoading = false
  }
}

function onRowBinChange(row: any) {
  row.batchNo = ''
  row.batches = []
  row.batchesKey = ''
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildLocationOptions() {
  const map = new Map<string, string>()
  for (const w of warehouses.value) map.set(w.code, w.name)
  for (const l of BASE_LOCATIONS) if (!map.has(l.code)) map.set(l.code, l.name)
  for (const line of detail.value) if (line.location && !map.has(line.location)) map.set(line.location, '')
  locationOptions.value = [...map.entries()].map(([code, name]) => ({ code, name }))
}

function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label || s
}

function statusType(s: string) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

// 发料进度标记：按领料明细 已发/需求量 汇总（不影响领料按钮，超发由后端跳过拦截）
const issueProgressOptions: Record<string, { label: string; type: string }> = {
  none: { label: '未领料', type: 'info' },
  partial: { label: '部分领料', type: 'warning' },
  issued: { label: '已发料', type: 'success' },
}

function issueProgress(order: any): string | null {
  if (!order || order.execStatus === 'none') return null
  const ms = order.materials || []
  if (ms.length === 0) return null
  const eps = 1e-6
  if (ms.every((m: any) => (m.issuedQty ?? 0) >= (m.requiredQty ?? 0) - eps)) return 'issued'
  if (ms.some((m: any) => (m.issuedQty ?? 0) > eps)) return 'partial'
  return 'none'
}

function workOrderOf(order: any) {
  // 未排产、已关闭的生产订单不能领料
  if (!order || order.status === 'closed') return null
  return order.execStatus !== 'none' && order.execStatus !== 'closed' ? order : null
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.orders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

async function openDialog(order: any) {
  currentOrder.value = order
  const wo = workOrderOf(order)
  if (!wo) {
    ElMessage.warning('该生产订单已关闭、尚未排产或执行已关闭，不能领料')
    return
  }
  form.warehouseId = warehouseIdByLocation(activeWarehouses.value, order.material?.location) || activeWarehouses.value[0]?.id || null
  form.effectiveDate = todayStr()
  dialogVisible.value = true
  workOrderReqSeq++
  await onWorkOrderChange(wo.id)
  // 顶部库位默认跟随明细行的共同库位（本单物料多在原料仓），没有共同库位时保留产品库位
  const locCodes = [...new Set(detail.value.map((l: any) => l.location).filter(Boolean))]
  const common = locCodes.length === 1 ? warehouseByCode.value.get(locCodes[0] as string) : null
  if (common) form.warehouseId = (common as any).id
  await loadStocks()
}

async function onWorkOrderChange(workOrderId?: number) {
  const id = workOrderId ?? workOrderOf(currentOrder.value)?.id
  const reqSeq = ++workOrderReqSeq
  currentWorkOrder.value = null
  detail.value = []
  if (!id) return
  const res: any = await productionApi.orderMaterialsOfOrder(id)
  if (reqSeq !== workOrderReqSeq) return
  const data = res.data || {}
  currentWorkOrder.value = data
  detail.value = (data.materials || []).map((m: any) => ({
    workOrderMaterialId: m.id,
    materialCode: m.material?.code,
    materialName: m.material?.name,
    material: m.material,
    unit: m.unit || m.material?.unit,
    issueUnit: m.unit || m.material?.unit,
    requiredQty: m.requiredQty,
    issuedQty: m.issuedQty ?? 0,
    location: m.material?.location || '',
    binId: null,
    issueQty: 0,
    batchNo: '',
    batches: [] as any[],
    batchesKey: '',
    batchesLoading: false,
  }))
  buildLocationOptions()
  form.issueQty = data.plannedQty ?? 0
  recalc()
}

// 单据行可选计量单位（基本单位 + 转换单位）
function rowUnitOptions(row: any): string[] {
  const set = new Set<string>()
  if (row.unit) set.add(row.unit)
  if (row.material?.units) for (const u of row.material.units) set.add(u)
  return [...set]
}

function recalc() {
  const qty = Number(form.issueQty) || 0
  const planQty = Number(currentWorkOrder.value?.plannedQty) || 0
  for (const line of detail.value) {
    const remain = line.requiredQty - line.issuedQty
    const perUnit = planQty > 0 ? line.requiredQty / planQty : 0
    const baseSuggest = Math.min(remain, Math.round(perUnit * qty * 100) / 100)
    const rate = line.material?.unitRates?.[line.issueUnit] || 1
    line.issueQty = rate > 0 ? Math.round((baseSuggest / rate) * 100) / 100 : baseSuggest
  }
}

async function submit() {
  if (!form.warehouseId) {
    ElMessage.warning('请选择库位')
    return
  }
  if (detail.value.some((l) => Number(l.issueQty) > 0 && l.material?.batchManaged && !l.batchNo)) {
    ElMessage.warning('批号管理物料必须选择批号')
    return
  }
  const badLine = detail.value.find((l) => Number(l.issueQty) > 0 && !rowWarehouseId(l))
  if (badLine) {
    ElMessage.warning(`${badLine.materialCode} 的库位「${badLine.location || '空'}」未对应启用仓库，请重新选择`)
    return
  }
  const items = detail.value
    .filter((l) => Number(l.issueQty) > 0)
    .map((l) => ({
      workOrderMaterialId: l.workOrderMaterialId,
      quantity: l.issueQty,
      unit: l.issueUnit || undefined,
      location: l.location || undefined,
      warehouseId: rowWarehouseId(l) || undefined,
      binId: l.binId || undefined,
      batchNo: l.batchNo || undefined,
    }))
  if (items.length === 0) {
    ElMessage.warning('请填写发放数量')
    return
  }
  submitting.value = true
  try {
    const res: any = await productionApi.issueOrderMaterials(currentWorkOrder.value.id, { warehouseId: form.warehouseId, effectiveDate: form.effectiveDate || undefined, items })
    const issued = res.data?.issued || []
    const skipped = res.data?.skipped || []
    if (skipped.length === 0) {
      ElMessage.success(`发料完成，共 ${issued.length} 行`)
    } else {
      const lines = skipped
        .map((s: any) => `${s.materialCode} ${s.materialName}：${s.reason}`)
        .join('<br/>')
      await ElMessageBox.alert(`已发 ${issued.length} 行，跳过 ${skipped.length} 行：<br/><br/>${lines}`, '发料结果', {
        dangerouslyUseHTMLString: true,
      })
    }
    dialogVisible.value = false
    loadData()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadWarehouses()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产领料</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 180px" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', status: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="生产订单号" width="150" />
        <el-table-column label="销售订单号" width="150">
          <template #default="{ row }">{{ row.salesOrder?.orderNo || row.salesOrderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发料状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="issueProgress(row)" size="small" :type="issueProgressOptions[issueProgress(row)!].type as any">
              {{ issueProgressOptions[issueProgress(row)!].label }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="!workOrderOf(row)" @click="openDialog(row)">领料</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="生产领料" width="960px" top="6vh" destroy-on-close>
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ currentOrder?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ currentOrder?.material?.code }} - {{ currentOrder?.material?.name }}</el-descriptions-item>
        <el-descriptions-item label="订单数量">{{ currentOrder?.quantity }}</el-descriptions-item>
      </el-descriptions>

      <el-form :model="form" label-width="110px" inline>
        <el-form-item label="库位">
          <el-select v-model="form.warehouseId" style="width: 220px" placeholder="选择库位" @change="(v: number) => onWarehouseChange(v)">
            <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
          <span class="batch-loc-tip">一键设置所有行；库存按每行库位计算，可在行内单独改</span>
        </el-form-item>
        <el-form-item label="生效日期">
          <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" placeholder="选择生效日期" style="width: 160px" />
        </el-form-item>
        <el-form-item label="本次发放数量" style="margin-left: 40px">
          <el-input-number v-model="form.issueQty" :min="0" :precision="2" :controls="false" style="width: 160px" @change="recalc" />
          <el-button style="margin-left: 8px">重算</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="detail" size="small" stripe max-height="360">
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <div>{{ row.materialCode }} - {{ row.materialName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="100">
          <template #default="{ row }">
            <el-select v-model="row.issueUnit" size="small" filterable allow-create default-first-option placeholder="单位" style="width: 100%">
              <el-option v-for="u in rowUnitOptions(row)" :key="u" :label="u" :value="u" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="库位" width="130">
          <template #default="{ row }">
            <el-select v-model="row.location" size="small" filterable allow-create default-first-option clearable placeholder="库位" style="width: 100%" @change="onRowLocationChange(row)">
              <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-if="hasBinRows" label="货位" width="150">
          <template #default="{ row }">
            <el-select v-model="row.binId" size="small" filterable clearable placeholder="选择货位" style="width: 100%" @change="onRowBinChange(row)">
              <el-option v-for="b in rowBins(row)" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="requiredQty" label="需求量" width="100" />
        <el-table-column prop="issuedQty" label="已发" width="90" />
        <el-table-column label="未发" width="90">
          <template #default="{ row }">{{ row.requiredQty - row.issuedQty }}</template>
        </el-table-column>
        <el-table-column label="当前库存" width="100" align="right">
          <template #default="{ row }">
            <span class="stock-num" :class="{ short: rowStockShort(row) }" :title="rowStockShort(row) ? '当前库存小于本次发放数量' : ''">{{ rowStock(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本次发放" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.issueQty" :min="0" :precision="2" :controls="false" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="批号" width="160">
          <template #default="{ row }">
            <el-select
              v-model="row.batchNo"
              size="small"
              filterable
              clearable
              :loading="row.batchesLoading"
              :placeholder="row.material?.batchManaged ? '选择批号（必选）' : '选择该仓库现有批次'"
              style="width: 100%"
              @visible-change="(v: boolean) => v && loadRowBatches(row)"
            >
              <el-option v-for="b in row.batches" :key="b.batchNo" :label="`${b.batchNo}（余 ${b.quantity}）`" :value="b.batchNo" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确认发料</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.batch-loc-tip {
  margin-left: 10px;
  font-size: 12px;
  color: var(--erp-steel);
}
.stock-num {
  font-weight: 600;
  color: var(--erp-ink);
}
.stock-num.short {
  color: var(--erp-red);
}
</style>
