<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockApi, warehouseApi, materialApi, stockTransactionTypeApi, warehouseBinApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const tableRef = ref()
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialKeyword: '', warehouseId: '', transactionTypeId: '', startDate: '', endDate: '', documentNo: '' })

const transactionTypes = ref<any[]>([])

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function loadOptions() {
  const [mRes, tRes]: any[] = await Promise.all([
    materialApi.options({ limit: 50 }),
    stockTransactionTypeApi.list({ pageSize: 200, status: 1 }),
  ])
  registerTransferMaterials(mRes.data || [])
  transactionTypes.value = (tRes.data.items || []).filter((t: any) => t.status === 1)
}

// ===== 移库 =====
const transferVisible = ref(false)
const transferring = ref(false)
const transferInitial = ref<any>({})
const transferMaterials = ref<any[]>([])
const transferMaterialLoading = ref(false)
const transferMaterialMap = new Map<number, any>()
const fromBins = ref<any[]>([])
const toBins = ref<any[]>([])
const transferBatchOptions = ref<any[]>([])
const transferBatchLoading = ref(false)
const transferForm = reactive<any>({
  materialId: null, unit: '', quantity: 1,
  fromWarehouseId: null, fromBinId: null,
  toWarehouseId: null, toBinId: null,
  batchNo: '', effectiveDate: todayStr(), orderNo: '', remark: '',
})

const tSelectedMaterial = computed(() => (transferForm.materialId ? transferMaterialMap.get(transferForm.materialId) : null))
const tFromWarehouse = computed(() => warehouses.value.find((w: any) => w.id === transferForm.fromWarehouseId) || null)
const tToWarehouse = computed(() => warehouses.value.find((w: any) => w.id === transferForm.toWarehouseId) || null)
const tFromBinRequired = computed(() => tFromWarehouse.value?.binManaged === true)
const tToBinRequired = computed(() => tToWarehouse.value?.binManaged === true)
const tBatchManaged = computed(() => tSelectedMaterial.value?.batchManaged === true)
const tBatchRequired = computed(() => tBatchManaged.value || transferBatchOptions.value.length > 0)
const tSelectedBatchQty = computed(() => {
  const b = transferBatchOptions.value.find((x: any) => x.batchNo === transferForm.batchNo)
  return b ? Number(b.quantity) : 0
})
const tUnitRate = computed(() => {
  const m = tSelectedMaterial.value
  if (!m || !transferForm.unit || transferForm.unit === m.unit) return 1
  return Number(m.unitRates?.[transferForm.unit]) || 1
})
const tBatchMaxQty = computed(() => Math.floor((tSelectedBatchQty.value / tUnitRate.value) * 100) / 100)
const tUnitOptions = computed<string[]>(() => {
  const m = tSelectedMaterial.value
  const set = new Set<string>(['个', '件', '套', '台', '只', '箱', '包'])
  if (m?.units) for (const u of m.units) set.add(u)
  if (transferForm.unit) set.add(transferForm.unit)
  return [...set]
})

function registerTransferMaterials(items: any[]) {
  for (const m of items) if (m?.id) transferMaterialMap.set(m.id, m)
  const selected = transferForm.materialId ? transferMaterialMap.get(transferForm.materialId) : null
  const seen = new Set<number>()
  transferMaterials.value = [...items, ...(selected ? [selected] : [])].filter((m: any) => {
    if (!m?.id || seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

async function searchTransferMaterials(keyword: string) {
  transferMaterialLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword, limit: 50 })
    registerTransferMaterials(res.data || [])
  } catch {
    /* ignore */
  } finally {
    transferMaterialLoading.value = false
  }
}

async function loadTransferBatches() {
  transferForm.batchNo = ''
  transferBatchOptions.value = []
  if (!transferForm.materialId || !transferForm.fromWarehouseId) return
  transferBatchLoading.value = true
  try {
    const res: any = await stockApi.batches({ materialId: transferForm.materialId, warehouseId: transferForm.fromWarehouseId, binId: transferForm.fromBinId || undefined, pageSize: 200 })
    transferBatchOptions.value = res.data.items || []
  } catch {
    transferBatchOptions.value = []
  } finally {
    transferBatchLoading.value = false
  }
}

async function loadFromBins() {
  transferForm.fromBinId = null
  fromBins.value = []
  const wh = tFromWarehouse.value
  if (wh?.binManaged) {
    const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
    fromBins.value = res.data.items
  }
  loadTransferBatches()
}

async function loadToBins() {
  transferForm.toBinId = null
  toBins.value = []
  const wh = tToWarehouse.value
  if (wh?.binManaged) {
    const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
    toBins.value = res.data.items
  }
}

function onTransferMaterialChange() {
  transferForm.unit = tSelectedMaterial.value?.unit || ''
  loadTransferBatches()
}

function openTransfer() {
  Object.assign(transferForm, {
    materialId: null, unit: '', quantity: 1,
    fromWarehouseId: null, fromBinId: null,
    toWarehouseId: null, toBinId: null,
    batchNo: '', effectiveDate: todayStr(), orderNo: '', remark: '',
  })
  fromBins.value = []
  toBins.value = []
  transferBatchOptions.value = []
  transferInitial.value = { ...transferForm }
  transferVisible.value = true
}

function isTransferDirty() {
  return JSON.stringify(transferForm) !== JSON.stringify(transferInitial.value)
}

function validateTransfer(): boolean {
  if (!transferForm.materialId) { ElMessage.warning('请选择物料'); return false }
  if (!transferForm.fromWarehouseId) { ElMessage.warning('请选择源仓库'); return false }
  if (tFromBinRequired.value && !transferForm.fromBinId) { ElMessage.warning('源仓库启用货位管理，请选择源货位'); return false }
  if (!transferForm.toWarehouseId) { ElMessage.warning('请选择目标仓库'); return false }
  if (tToBinRequired.value && !transferForm.toBinId) { ElMessage.warning('目标仓库启用货位管理，请选择目标货位'); return false }
  if (transferForm.fromWarehouseId === transferForm.toWarehouseId && (transferForm.fromBinId || null) === (transferForm.toBinId || null)) {
    ElMessage.warning('源与目标不能相同')
    return false
  }
  if (!(transferForm.quantity > 0)) { ElMessage.warning('移库数量必须大于0'); return false }
  if (tBatchRequired.value && !transferForm.batchNo) { ElMessage.warning('该物料或源货位存在批次库存，请选择批号'); return false }
  if (transferForm.batchNo && transferForm.quantity * tUnitRate.value > tSelectedBatchQty.value + 1e-6) {
    ElMessage.warning(`移库数量超过该批余量 ${tSelectedBatchQty.value}（当前单位最多可录入 ${tBatchMaxQty.value}）`)
    return false
  }
  return true
}

async function doTransfer(): Promise<boolean> {
  transferring.value = true
  try {
    await stockApi.transfer({
      materialId: transferForm.materialId,
      unit: transferForm.unit || undefined,
      quantity: transferForm.quantity,
      fromWarehouseId: transferForm.fromWarehouseId,
      fromBinId: tFromBinRequired.value ? transferForm.fromBinId : undefined,
      toWarehouseId: transferForm.toWarehouseId,
      toBinId: tToBinRequired.value ? transferForm.toBinId : undefined,
      batchNo: transferForm.batchNo || undefined,
      effectiveDate: transferForm.effectiveDate || todayStr(),
      orderNo: transferForm.orderNo || undefined,
      remark: transferForm.remark || undefined,
    })
    ElMessage.success('移库成功')
    loadData()
    return true
  } catch {
    return false
  } finally {
    transferring.value = false
  }
}

async function handleTransferSubmit(): Promise<boolean> {
  if (!validateTransfer()) return false
  return doTransfer()
}

async function confirmTransfer() {
  if (!validateTransfer()) return
  try {
    await ElMessageBox.confirm('确定提交该移库操作吗？', '确认提交', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  if (await doTransfer()) transferVisible.value = false
}

function confirmTransferLeave(done?: () => void) {
  const close = () => {
    if (done) done()
    else transferVisible.value = false
  }
  if (!isTransferDirty()) {
    close()
    return
  }
  ElMessageBox.confirm('当前移库尚未保存，是否保存后关闭？', '未保存的修改', {
    confirmButtonText: '保存',
    cancelButtonText: '不保存',
    distinguishCancelAndClose: true,
    type: 'warning',
  })
    .then(async () => {
      if (await handleTransferSubmit()) close()
    })
    .catch((action: string) => {
      if (action === 'cancel') close()
    })
}


// 流水时间按本地时区显示（后端返回 ISO/UTC 字符串）
function fmtDateTime(v: any) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function signedQty(row: any) {
  const q = Number(row.quantity) || 0
  const signed = row.type === 'out' ? -q : q
  return signed > 0 ? `+${signed}` : String(signed)
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.records(query)
    list.value = res.data.items
    total.value = res.data.total
    currentRow.value = null
    tableRef.value?.setCurrentRow()
  } finally { loading.value = false }
}

function printSelected() {
  const row = currentRow.value
  if (!row?.documentNo) return
  router.push({
    path: '/inventory/record-print',
    query: { documentNo: row.documentNo, ...(row.transactionTypeId ? { typeId: String(row.transactionTypeId) } : {}) },
  })
}

function redSelected() {
  const row = currentRow.value
  if (!row?.documentNo) return
  const path = row.type === 'in' ? '/inventory/stock-in' : '/inventory/stock-out'
  router.push({ path, query: { red: row.documentNo } })
}

onMounted(async () => {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
  await loadOptions()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <div class="row-actions">
          <el-button type="success" plain @click="router.push('/inventory/stock-in')"><el-icon><Download /></el-icon>入库</el-button>
          <el-button type="danger" plain @click="router.push('/inventory/stock-out')"><el-icon><Upload /></el-icon>出库</el-button>
          <el-button type="warning" plain @click="openTransfer()"><el-icon><Switch /></el-icon>移库</el-button>
          <el-button type="primary" plain :disabled="!currentRow?.documentNo" title="先点击列表中的行，再打印该单号" @click="printSelected"><el-icon><Printer /></el-icon>打印</el-button>
          <el-button type="danger" plain :disabled="!currentRow?.documentNo" title="先点击列表中的行，再生成红单冲销" @click="redSelected"><el-icon><DocumentRemove /></el-icon>红单</el-button>
        </div>
      </div>

      <div class="search-bar">
        <el-input v-model="query.documentNo" placeholder="事务单号/源单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-select v-model="query.transactionTypeId" placeholder="事务类型" clearable filterable style="width: 160px">
          <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description || t.code" :value="t.id" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', transactionTypeId: '', startDate: '', endDate: '', documentNo: '', page: 1 }), loadData()">重置</el-button>
      </div>


      <el-table ref="tableRef" :data="list" v-loading="loading" stripe highlight-current-row max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="生效日期" width="100">
          <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="事务单号" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.documentNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="源单号" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="行号" width="56" align="center">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="事务类型" width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.transactionType">{{ row.transactionType.description }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="物料编码" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="封装" width="80" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.packageType || '-' }}</template>
        </el-table-column>
        <el-table-column label="品牌" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.brand || '-' }}</template>
        </el-table-column>
        <el-table-column label="物料备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="库位" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="batchNo" label="批号" width="130" show-overflow-tooltip />
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.um || row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="数量" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: Number(signedQty(row)) >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)', fontWeight: 600 }">
              {{ signedQty(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">{{ row.price != null ? Number(row.price).toFixed(6) : '-' }}</template>
        </el-table-column>
        <el-table-column label="部门" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="经手人" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.handler || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓管员" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.keeper || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="mainRemark" label="主备注" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mainRemark || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的事务流水" :image-size="56">
            <div class="empty-tip">「单号」同时匹配系统事务单号与手工源单号；可清空物料/仓库/日期条件后重试</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <!-- 移库 -->
    <el-dialog v-model="transferVisible" title="库存移库" width="560px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false" :before-close="confirmTransferLeave">
      <el-form :model="transferForm" label-width="100px">
        <el-form-item label="物料" required>
          <el-select v-model="transferForm.materialId" filterable remote reserve-keyword :remote-method="searchTransferMaterials" :loading="transferMaterialLoading" placeholder="输入编码/名称搜索物料" style="width: 100%" @change="onTransferMaterialChange">
            <el-option v-for="m in transferMaterials" :key="m.id" :label="`${m.code} - ${m.name}${m.specification ? ' / ' + m.specification : ''}`" :value="m.id" />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">源</el-divider>
        <el-form-item label="源仓库" required>
          <el-select v-model="transferForm.fromWarehouseId" placeholder="选择源仓库" style="width: 100%" @change="loadFromBins">
            <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="tFromBinRequired" label="源货位" required>
          <el-select v-model="transferForm.fromBinId" placeholder="选择源货位" filterable style="width: 100%" @change="loadTransferBatches">
            <el-option v-for="b in fromBins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="批号" :required="tBatchRequired">
          <el-select v-model="transferForm.batchNo" filterable clearable :loading="transferBatchLoading" :placeholder="tBatchRequired ? '选择源批次（必选）' : '可选：选择源批次'" style="width: 100%">
            <el-option v-for="b in transferBatchOptions" :key="b.batchNo" :label="`${b.batchNo}（余 ${b.quantity}）`" :value="b.batchNo" />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">目标</el-divider>
        <el-form-item label="目标仓库" required>
          <el-select v-model="transferForm.toWarehouseId" placeholder="选择目标仓库" style="width: 100%" @change="loadToBins">
            <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="tToBinRequired" label="目标货位" required>
          <el-select v-model="transferForm.toBinId" placeholder="选择目标货位" filterable style="width: 100%">
            <el-option v-for="b in toBins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="数量" required>
          <el-input-number v-model="transferForm.quantity" :min="0.01" :max="transferForm.batchNo ? tBatchMaxQty : undefined" :controls="false" style="width: 100%" />
          <div v-if="transferForm.batchNo" class="unit-hint">该批余量 {{ tSelectedBatchQty }}</div>
        </el-form-item>
        <el-form-item label="计量单位">
          <el-select v-model="transferForm.unit" filterable allow-create default-first-option clearable placeholder="默认基本单位" style="width: 100%">
            <el-option v-for="u in tUnitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="生效日期">
          <el-input v-model="transferForm.effectiveDate" type="date" style="width: 100%" />
        </el-form-item>
        <el-form-item label="单号">
          <el-input v-model="transferForm.orderNo" placeholder="手工单号（可选，系统单号自动生成）" clearable />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="transferForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmTransferLeave()">取消</el-button>
        <el-button type="primary" :loading="transferring" @click="confirmTransfer">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.unit-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
