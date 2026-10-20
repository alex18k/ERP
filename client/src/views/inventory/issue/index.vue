<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi } from '../../../api'
import { BASE_LOCATIONS, warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, orderNo: '', status: '' })

const statusOptions = [
  { label: '已计划', value: 'planned' },
  { label: '生产中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

const dialogVisible = ref(false)
const submitting = ref(false)
const currentOrder = ref<any>(null)
const currentBatch = ref<any>(null)
const detail = ref<any[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const form = reactive<any>({ batchId: null, warehouseId: null, issueQty: 0, effectiveDate: '' })
let batchReqSeq = 0

const bins = ref<any[]>([])
const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const binRequired = computed(() => selectedWarehouse.value?.binManaged === true)

async function loadBins() {
  bins.value = []
  const wh = selectedWarehouse.value
  if (!wh?.binManaged) return
  const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
  bins.value = res.data.items
}

async function onWarehouseChange() {
  for (const line of detail.value) line.binId = null
  await loadBins()
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

function batchList(order: any) {
  return (order?.batches || []).filter((b: any) => b.status !== 'cancelled')
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
  const batches = batchList(order)
  if (batches.length === 0) {
    ElMessage.warning('该生产订单尚未排产，无物料需求')
    return
  }
  form.batchId = batches[0].id
  form.warehouseId = warehouseIdByLocation(activeWarehouses.value, order.material?.location) || activeWarehouses.value[0]?.id || null
  form.effectiveDate = todayStr()
  dialogVisible.value = true
  await onBatchChange()
  await loadBins()
}

async function onBatchChange() {
  const batchId = form.batchId
  const reqSeq = ++batchReqSeq
  const batch = batchList(currentOrder.value).find((b: any) => b.id === batchId)
  currentBatch.value = batch || null
  detail.value = []
  if (!batch) {
    return
  }
  const res: any = await productionApi.batchMaterialsOfBatch(batch.id)
  if (reqSeq !== batchReqSeq || form.batchId !== batchId) return
  const data = res.data || {}
  currentBatch.value = data
  detail.value = (data.materials || []).map((m: any) => ({
    batchMaterialId: m.id,
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
  }))
  buildLocationOptions()
  form.issueQty = data.quantity ?? 0
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
  const batchQty = Number(currentBatch.value?.quantity) || 0
  for (const line of detail.value) {
    const remain = line.requiredQty - line.issuedQty
    const perUnit = batchQty > 0 ? line.requiredQty / batchQty : 0
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
  if (binRequired.value && detail.value.some((l) => Number(l.issueQty) > 0 && !l.binId)) {
    ElMessage.warning('该仓库启用货位管理，请为发料行选择货位')
    return
  }
  const items = detail.value
    .filter((l) => Number(l.issueQty) > 0)
    .map((l) => ({ batchMaterialId: l.batchMaterialId, quantity: l.issueQty, unit: l.issueUnit || undefined, location: l.location || undefined, binId: l.binId || undefined, batchNo: l.batchNo || undefined }))
  if (items.length === 0) {
    ElMessage.warning('请填写发放数量')
    return
  }
  submitting.value = true
  try {
    const res: any = await productionApi.issueBatch(currentBatch.value.id, { warehouseId: form.warehouseId, effectiveDate: form.effectiveDate || undefined, items })
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
        <span class="toolbar-title">生产发料（按生产订单）</span>
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
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="100" />
        <el-table-column label="批次" width="90">
          <template #default="{ row }">{{ batchList(row).length }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="batchList(row).length === 0" @click="openDialog(row)">发料</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="生产发料" width="960px" top="6vh" destroy-on-close>
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ currentOrder?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ currentOrder?.material?.code }} - {{ currentOrder?.material?.name }}</el-descriptions-item>
        <el-descriptions-item label="订单数量">{{ currentOrder?.quantity }}</el-descriptions-item>
        <el-descriptions-item label="批次数量">{{ currentBatch?.quantity ?? '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-form :model="form" label-width="110px" inline>
        <el-form-item label="发放批次">
          <el-select v-model="form.batchId" style="width: 200px" @change="onBatchChange">
            <el-option v-for="b in batchList(currentOrder)" :key="b.id" :label="`第${b.batchNo}批（${b.quantity}）`" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位">
          <el-select v-model="form.warehouseId" style="width: 220px" placeholder="选择库位" @change="onWarehouseChange">
            <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
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
            <el-select v-model="row.location" size="small" filterable allow-create default-first-option clearable placeholder="库位" style="width: 100%">
              <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-if="binRequired" label="货位" width="150">
          <template #default="{ row }">
            <el-select v-model="row.binId" size="small" filterable clearable placeholder="选择货位" style="width: 100%">
              <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="requiredQty" label="需求量" width="100" />
        <el-table-column prop="issuedQty" label="已发" width="90" />
        <el-table-column label="未发" width="90">
          <template #default="{ row }">{{ row.requiredQty - row.issuedQty }}</template>
        </el-table-column>
        <el-table-column label="本次发放" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.issueQty" :min="0" :precision="2" :controls="false" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="批号" width="160">
          <template #default="{ row }">
            <el-input v-model="row.batchNo" placeholder="批号管理物料必填" size="small" />
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
