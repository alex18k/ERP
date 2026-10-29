<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi, stockApi } from '../../../api'
import { BASE_LOCATIONS, warehouseIdByLocation } from '../../../utils/location'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const warehouses = ref<any[]>([])
const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const order = ref<any>(null)
const detail = ref<any[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const form = reactive<any>({ warehouseId: null, issueQty: 0, effectiveDate: '' })

// 可用库存按「领料明细行库位」计算：行库位代码 → 仓库；货位管理仓库选了货位则取该货位结存
const stockTotals = ref<Map<string, number>>(new Map()) // `${warehouseId}|${materialId}` → 仓库结存合计
const stockByBin = ref<Map<string, number>>(new Map()) // `${warehouseId}|${materialId}|${binId}`
const binsByWarehouse = ref<Map<number, any[]>>(new Map())
const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const warehouseByCode = computed(() => new Map(activeWarehouses.value.map((w: any) => [w.code, w])))

// 未发口径：需求量 - 已发 - 已取消
function lineRemain(m: any) {
  return Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function backToList() {
  router.replace('/inventory/issue')
}

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
    const res: any = await stockApi.batches({ materialId: row.material.id, warehouseId: whId, binId: rowBinRequired(row) && !row.binId ? 'none' : row.binId || undefined, pageSize: 200 })
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

function buildLocationOptions() {
  const map = new Map<string, string>()
  for (const w of warehouses.value) map.set(w.code, w.name)
  for (const l of BASE_LOCATIONS) if (!map.has(l.code)) map.set(l.code, l.name)
  for (const line of detail.value) if (line.location && !map.has(line.location)) map.set(line.location, '')
  locationOptions.value = [...map.entries()].map(([code, name]) => ({ code, name }))
}

// 单据行可选计量单位（基本单位 + 转换单位）
function rowUnitOptions(row: any): string[] {
  const set = new Set<string>()
  if (row.unit) set.add(row.unit)
  if (row.material?.units) for (const u of row.material.units) set.add(u)
  return [...set]
}

// 按订单数量等比给出建议发放量；已勾选「取消未发」的行不参与
function recalc() {
  const qty = Number(form.issueQty) || 0
  const planQty = Number(order.value?.plannedQty) || 0
  for (const line of detail.value) {
    if (line.cancelRemain) {
      line.issueQty = 0
      continue
    }
    const remain = lineRemain(line)
    const perUnit = planQty > 0 ? line.requiredQty / planQty : 0
    const baseSuggest = Math.min(remain, Math.round(perUnit * qty * 100) / 100)
    const rate = line.material?.unitRates?.[line.issueUnit] || 1
    line.issueQty = rate > 0 ? Math.round((baseSuggest / rate) * 100) / 100 : baseSuggest
  }
}

// 勾选「取消未发」：该行未发不再发料，本次发放清零
function onCancelRemainChange(row: any) {
  if (row.cancelRemain) row.issueQty = 0
}

// 与后端发料校验同口径：已关闭/未排产/执行关闭/已完工 的订单不允许发料
function issuableError(data: any): string | null {
  if (data?.status === 'closed') return '该生产订单已关闭，不能发料'
  if (data?.execStatus === 'none') return '该生产订单尚未排产，不能发料'
  if (data?.execStatus === 'closed') return '该生产订单执行已关闭，不能发料'
  if (data?.execStatus === 'completed') return '该生产订单已完工，不能发料'
  return null
}

async function loadPage() {
  const id = Number(route.query.orderId)
  if (!Number.isInteger(id) || id <= 0) {
    ElMessage.warning('缺少生产订单参数')
    backToList()
    return
  }
  loading.value = true
  try {
    const [wRes, oRes]: any[] = await Promise.all([
      warehouseApi.list({ pageSize: 200 }),
      productionApi.orderMaterialsOfOrder(id),
    ])
    warehouses.value = wRes?.data?.items || []
    const data = oRes?.data
    if (!data) {
      ElMessage.warning('生产订单不存在')
      backToList()
      return
    }
    const err = issuableError(data)
    if (err) {
      ElMessage.warning(err)
      backToList()
      return
    }
    detail.value = (data.materials || []).map((m: any) => ({
      workOrderMaterialId: m.id,
      materialCode: m.material?.code,
      materialName: m.material?.name,
      material: m.material,
      unit: m.unit || m.material?.unit,
      issueUnit: m.unit || m.material?.unit,
      requiredQty: m.requiredQty,
      issuedQty: m.issuedQty ?? 0,
      cancelledQty: m.cancelledQty ?? 0,
      cancelRemain: false,
      location: m.material?.location || '',
      binId: null,
      issueQty: 0,
      batchNo: '',
      batches: [] as any[],
      batchesKey: '',
      batchesLoading: false,
    }))
    order.value = data
    form.issueQty = data.plannedQty ?? 0
    form.effectiveDate = todayStr()
    form.warehouseId = warehouseIdByLocation(activeWarehouses.value, data.material?.location) || activeWarehouses.value[0]?.id || null
    // 顶部库位默认跟随明细行的共同库位，没有共同库位时保留产品库位
    const locCodes = [...new Set(detail.value.map((l: any) => l.location).filter(Boolean))]
    if (locCodes.length === 1) {
      const common = activeWarehouses.value.find((w: any) => w.code === locCodes[0])
      if (common) form.warehouseId = common.id
    }
    buildLocationOptions()
    recalc()
    await loadStocks()
  } catch (e: any) {
    ElMessage.warning(e?.response?.data?.message || '生产订单不存在')
    backToList()
  } finally {
    loading.value = false
  }
}

onMounted(loadPage)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">生产发料</span>
        <el-button style="margin-left: 12px" @click="backToList"><el-icon><Back /></el-icon>返回</el-button>
      </div>

      <el-descriptions :column="5" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ order?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ order?.material?.code }} - {{ order?.material?.name }}</el-descriptions-item>
        <el-descriptions-item label="订单数量">{{ order?.quantity }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ order?.status }}</el-descriptions-item>
        <el-descriptions-item label="执行状态">{{ order?.execStatus }}</el-descriptions-item>
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
          <el-button style="margin-left: 8px" @click="recalc">重算</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="detail" size="small" stripe max-height="calc(100vh - 320px)">
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
          <template #default="{ row }">{{ row.cancelRemain ? 0 : lineRemain(row) }}</template>
        </el-table-column>
        <el-table-column label="取消未发" width="90" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.cancelRemain" :disabled="lineRemain(row) <= 1e-6" @change="onCancelRemainChange(row)" />
          </template>
        </el-table-column>
        <el-table-column label="当前库存" width="100" align="right">
          <template #default="{ row }">
            <span class="stock-num" :class="{ short: rowStockShort(row) }" :title="rowStockShort(row) ? '当前库存小于本次发放数量' : ''">{{ rowStock(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本次发放" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.issueQty" :min="0" :precision="2" :controls="false" :disabled="row.cancelRemain" style="width: 100%" />
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

      <div class="issue-footer">
        <span>已填 <b>{{ detail.filter((l: any) => Number(l.issueQty) > 0).length }}</b> 行</span>
        <span>取消未发 <b>{{ detail.filter((l: any) => l.cancelRemain && lineRemain(l) > 1e-6).length }}</b> 行</span>
      </div>
    </div>
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
.issue-footer {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--erp-steel);
}
</style>
