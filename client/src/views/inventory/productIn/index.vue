<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockApi, warehouseApi, materialApi, stockTransactionTypeApi, warehouseBinApi, workshopApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'
import { useAuthStore } from '../../../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const currentUserName = authStore.user?.realName || authStore.user?.username || ''
const saving = ref(false)
const transactionTypes = ref<any[]>([])
const warehouses = ref<any[]>([])
const departments = ref<any[]>([])
const handlerOptions = ref<string[]>([])
const keeperOptions = ref<string[]>([])
const approverOptions = ref<string[]>([])
const binMap = reactive<Record<number, any[]>>({})
const currentRow = ref<any>(null)
const redDocNo = ref('')
const isRed = computed(() => !!redDocNo.value)

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function newRow() {
  return {
    materialId: null as number | null,
    material: null as any,
    materialOptions: [] as any[],
    materialLoading: false,
    unit: '',
    unitOptions: [] as string[],
    warehouseId: null as number | null,
    binId: null as number | null,
    batches: [] as any[],
    batchNo: '',
    stockQty: null as number | null,
    quantity: 1,
    remark: '',
  }
}

const form = reactive({
  transactionTypeId: null as number | null,
  effectiveDate: todayStr(),
  orderNo: '',
  departmentId: null as number | null,
  handler: '',
  keeper: currentUserName,
  approver: '',
  remark: '',
  items: [newRow()],
})

function warehouseBinManaged(warehouseId: number | null) {
  return !!warehouseId && warehouses.value.find((w: any) => w.id === warehouseId)?.binManaged === true
}

function binOptionsFor(warehouseId: number | null) {
  return warehouseId ? binMap[warehouseId] || [] : []
}

async function loadBins(warehouseId: number | null) {
  if (!warehouseId || !warehouseBinManaged(warehouseId)) return
  if (binMap[warehouseId]) return
  try {
    const res: any = await warehouseBinApi.list({ warehouseId, status: 1, pageSize: 200 })
    binMap[warehouseId] = res.data.items || []
  } catch {
    binMap[warehouseId] = []
  }
}

function onQuantityInput(row: any, value: number | undefined) {
  if (!isRed.value && value != null && value < 0) row.quantity = 0
}

function preventNegativeKey(e: KeyboardEvent) {
  if (isRed.value) return
  if (e.key === '-' || e.key === '+' || e.key.toLowerCase() === 'e') e.preventDefault()
}

// 单价取物料主文件成本；按录入单位换算（1 录入单位 = N 基本单位）
function rowUnitCost(row: any) {
  const cost = Number(row.material?.cost) || 0
  const baseUnit = row.material?.unit
  let rate = 1
  if (row.unit && baseUnit && row.unit !== baseUnit) rate = Number(row.material?.unitRates?.[row.unit]) || 0
  return cost * rate
}

function rowAmount(row: any) {
  return (Number(row.quantity) || 0) * rowUnitCost(row)
}

// 实时汇总：只统计已选物料且数量 > 0 的行
const filledLines = computed(() => form.items.filter((r: any) => r.materialId && Number(r.quantity) !== 0).length)
const totalQty = computed(() => form.items.reduce((s: number, r: any) => (r.materialId && Number(r.quantity) !== 0 ? s + Number(r.quantity) : s), 0))
const totalAmount = computed(() => form.items.reduce((s: number, r: any) => (r.materialId && Number(r.quantity) !== 0 ? s + rowAmount(r) : s), 0))

// 已填行不用变色：明细行保持白底
function itemRowClass() {
  return ''
}

async function searchRowMaterials(row: any, keyword: string) {
  row.materialLoading = true
  try {
    const res: any = await materialApi.options({ keyword, limit: 50 })
    row.materialOptions = res.data || []
  } catch {
    row.materialOptions = []
  } finally {
    row.materialLoading = false
  }
}

async function onRowMaterialChange(row: any) {
  const m = row.materialOptions.find((x: any) => x.id === row.materialId)
  row.material = m || null
  row.unit = m?.unit || ''
  const units = new Set<string>()
  if (m?.unit) units.add(m.unit)
  if (m?.units) for (const u of m.units) units.add(u)
  row.unitOptions = [...units]
  row.batchNo = ''
  row.batches = []
  row.binId = null
  row.stockQty = null
  // 按物料主文件的默认库位自动带出仓库
  row.warehouseId = warehouseIdByLocation(activeWarehouses.value, m?.location || '')
  if (row.warehouseId) {
    await loadBins(row.warehouseId)
    loadRowBatches(row)
    loadRowStock(row)
  }
}

async function onRowWarehouseChange(row: any) {
  row.binId = null
  row.batchNo = ''
  row.batches = []
  row.stockQty = null
  await loadBins(row.warehouseId)
  loadRowBatches(row)
  loadRowStock(row)
}

async function onRowBinChange(row: any) {
  await loadRowBatches(row)
  loadRowStock(row)
}

async function loadRowStock(row: any) {
  row.stockQty = null
  if (!row.materialId || !row.warehouseId) return
  const scopeBin = warehouseBinManaged(row.warehouseId) && !row.binId ? "none" : row.binId || undefined
  try {
    const res: any = await stockApi.list({
      materialId: row.materialId,
      warehouseId: row.warehouseId,
      binId: scopeBin,
      pageSize: 1000,
    })
    const items = res.data.items || []
    row.stockQty = Number(items[0]?.quantity ?? 0)
  } catch {
    row.stockQty = null
  }
}

async function loadRowBatches(row: any) {
  row.batchNo = ''
  row.batches = []
  if (!row.materialId || !row.warehouseId) return
  const scopeBin = warehouseBinManaged(row.warehouseId) && !row.binId ? "none" : row.binId || undefined
  try {
    const res: any = await stockApi.batches({
      materialId: row.materialId,
      warehouseId: row.warehouseId,
      binId: scopeBin,
      pageSize: 200,
    })
    row.batches = res.data.items || []
  } catch {
    row.batches = []
  }
}

// 红单：按原入库单调出数据，数量自动取负（冲销），提交后扣回库存
async function loadRedDocument(no: string) {
  try {
    const res: any = await stockApi.recordsByDocument(no)
    const items = res.data.items || []
    if (!items.length) {
      ElMessage.warning(`红单：未找到单据 ${no} 的流水`)
      return
    }
    redDocNo.value = no
    const first = items[0]
    Object.assign(form, {
      transactionTypeId: first.transactionTypeId ?? null,
      effectiveDate: todayStr(),
      orderNo: first.orderNo || '',
      departmentId: first.departmentId ?? null,
      handler: first.handler || '',
      keeper: first.keeper || '',
      approver: first.approver || '',
      remark: first.mainRemark || '',
      items: [],
    })
    for (const r of items) {
      const row = newRow()
      row.quantity = -Math.abs(Number(r.quantity) || 0)
      row.remark = `红单冲销 ${no}`
      const mres: any = await materialApi.options({ keyword: r.material?.code || '', limit: 5 })
      const m = (mres.data || []).find((x: any) => x.id === r.materialId) || null
      row.materialId = r.materialId ?? null
      row.material = m
      row.materialOptions = m ? [m] : []
      // 红单数量是流水的基本单位数量，单位必须使用基本单位，避免后端再次换算
      row.unit = m?.unit || ''
      row.unitOptions = row.unit ? [row.unit] : []
      row.warehouseId = r.warehouseId ?? null
      row.binId = r.binId ?? null
      await loadBins(row.warehouseId)
      await loadRowBatches(row)
      row.batchNo = r.batchNo || ''
      await loadRowStock(row)
      form.items.push(row)
    }
    ElMessage.info(`红单模式：已按 ${no} 调出明细，数量已取负`)
  } catch { /* error shown by interceptor */ }
}

function addRow() {
  form.items.push(newRow())
}

function onCurrentChange(row: any) {
  currentRow.value = row
}

function removeSelected() {
  if (!currentRow.value) return
  const index = form.items.indexOf(currentRow.value)
  if (index >= 0) form.items.splice(index, 1)
  currentRow.value = null
}

function validateForm(): boolean {
  if (!form.transactionTypeId) { ElMessage.warning('请选择事务类型'); return false }
  if (form.items.length === 0) { ElMessage.warning('请至少添加一条入库明细'); return false }
  for (let i = 0; i < form.items.length; i++) {
    const row = form.items[i]
    const line = `第 ${i + 1} 行`
    if (!row.materialId) { ElMessage.warning(`${line}请选择物料`); return false }
    if (!row.warehouseId) { ElMessage.warning(`${line}请选择仓库`); return false }
    if (isRed.value ? !(Number(row.quantity) < 0) : !(Number(row.quantity) > 0)) {
      ElMessage.warning(isRed.value ? `${line}红单数量必须为负数` : `${line}数量必须大于0`)
      return false
    }
  }
  return true
}

async function submit() {
  if (!validateForm()) return
  try {
    await ElMessageBox.confirm(
      `已填 ${filledLines.value} 行，数量合计 ${totalQty.value}，金额 ¥${totalAmount.value.toFixed(2)}。提交后库存将${isRed.value ? '减少（红单冲销）' : '增加'}且不可撤销，是否继续？`,
      isRed.value ? '提交红单' : '提交入库',
      {
        type: 'warning',
        confirmButtonText: isRed.value ? '提交红单' : '提交入库',
        cancelButtonText: '取消',
      },
    )
  } catch { return }
  saving.value = true
  try {
    const items = form.items.map((row: any) => ({
      materialId: row.materialId,
      warehouseId: row.warehouseId,
      binId: row.binId || undefined,
      batchNo: row.batchNo || undefined,
      quantity: row.quantity,
      unit: row.unit || undefined,
      remark: row.remark || undefined,
    }))
    const res: any = await stockApi.inBatch({
      transactionTypeId: form.transactionTypeId,
      effectiveDate: form.effectiveDate || undefined,
      orderNo: form.orderNo || undefined,
      departmentId: form.departmentId || undefined,
      handler: form.handler || undefined,
      keeper: form.keeper || undefined,
      approver: form.approver || undefined,
      mainRemark: form.remark || undefined,
      items,
    })
    const doneText = isRed.value ? '红单已提交' : '入库已提交'
    ElMessage.success(res.data?.documentNo ? `${doneText}，单据号 ${res.data.documentNo}` : doneText)
    resetForm()
  } catch { /* error shown by interceptor */ } finally {
    saving.value = false
  }
}

function resetForm() {
  currentRow.value = null
  redDocNo.value = ''
  if (route.query.red) router.replace({ path: route.path })
  Object.assign(form, {
    transactionTypeId: form.transactionTypeId,
    effectiveDate: todayStr(),
    orderNo: '',
    departmentId: null,
    handler: '',
    keeper: currentUserName,
    approver: '',
    remark: '',
    items: [newRow()],
  })
}

onMounted(async () => {
  const [wRes, tRes, dRes, hRes, kRes, aRes]: any[] = await Promise.all([
    warehouseApi.list({ pageSize: 200 }),
    stockTransactionTypeApi.list({ pageSize: 200, status: 1 }),
    workshopApi.list(),
    stockApi.handlers(),
    stockApi.handlers('keeper'),
    stockApi.handlers('approver'),
  ])
  warehouses.value = wRes.data.items || []
  transactionTypes.value = (tRes.data.items || []).filter((t: any) => t.status === 1 && t.direction === 'in')
  if (!form.transactionTypeId) {
    form.transactionTypeId = transactionTypes.value.find((t: any) => t.code === 'RCT-MC' || t.description === '自制加工')?.id ?? transactionTypes.value[0]?.id ?? null
  }
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  handlerOptions.value = hRes.data || []
  keeperOptions.value = [...new Set([currentUserName, ...(kRes.data || [])].filter(Boolean))]
  approverOptions.value = aRes.data || []
  const red = String(route.query.red || '').trim()
  if (red) await loadRedDocument(red)
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">产品入库</span>
        <el-button style="margin-left: 12px" @click="router.push('/inventory/product-in-maintain')"><el-icon><Back /></el-icon>返回</el-button>
        <div style="flex: 1" />
        <span class="doc-summary">
          已填 <b>{{ filledLines }}</b> 行 · 数量 <b>{{ totalQty }}</b> · 金额 <b>¥{{ totalAmount.toFixed(2) }}</b>
        </span>
        <el-button @click="resetForm">新增</el-button>
        <el-button type="primary" :loading="saving" @click="submit">{{ isRed ? '提交红单' : '提交入库' }}</el-button>
      </div>

      <el-form :model="form" label-width="72px" class="kd-header-form">
        <div class="erp-group">
          <div class="kd-grid">
            <div class="kd-field">
              <el-form-item label="生效日期">
                <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" class="kd-flex kd-date" placeholder="选择日期" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="事务类型" required>
                <el-select v-model="form.transactionTypeId" filterable placeholder="选择入库事务类型" class="kd-flex">
                  <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description" :value="t.id" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="生产车间">
                <el-select v-model="form.departmentId" filterable clearable placeholder="选择生产车间" class="kd-flex">
                  <el-option v-for="d in departments" :key="d.id" :label="`${d.code} - ${d.name}`" :value="d.id" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="来源单号">
                <el-input v-model="form.orderNo" class="kd-flex" placeholder="手工来源单号（可选）" clearable />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="入库人">
                <el-select v-model="form.handler" filterable clearable allow-create default-first-option placeholder="选择或输入入库人" class="kd-flex">
                  <el-option v-for="h in handlerOptions" :key="h" :label="h" :value="h" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="仓管员">
                <el-select v-model="form.keeper" filterable clearable allow-create default-first-option placeholder="选择或输入仓管员" class="kd-flex">
                  <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="审核人">
                <el-select v-model="form.approver" filterable clearable allow-create default-first-option placeholder="选择或输入审核人" class="kd-flex">
                  <el-option v-for="a in approverOptions" :key="a" :label="a" :value="a" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="主备注">
                <el-input v-model="form.remark" class="kd-flex" placeholder="主备注（表头，可选）" maxlength="500" clearable />
              </el-form-item>
            </div>
          </div>
        </div>

        <div style="width: 100%">
          <el-button size="small" type="primary" plain @click="addRow"><el-icon><Plus /></el-icon>添加明细</el-button>
          <el-button size="small" type="primary" plain style="margin-left: 8px" :disabled="!currentRow" @click="removeSelected">删除选中</el-button>
          <el-tag v-if="isRed" type="danger" size="small" style="margin-left: 12px">红单：按 {{ redDocNo }} 生成负数冲销</el-tag>
          <el-table class="items-editor" :data="form.items" size="small" border max-height="calc(100vh - 320px)" style="margin-top: 8px; width: 100%" highlight-current-row :row-class-name="itemRowClass" @current-change="onCurrentChange">
        <el-table-column label="行号" width="50" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column width="100">
          <template #header><span class="req-th">仓库</span></template>
          <template #default="{ row }">
            <el-select v-model="row.warehouseId" placeholder="选择仓库" style="width: 100%" @change="onRowWarehouseChange(row)">
              <el-option v-for="w in activeWarehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column width="110">
          <template #header><span class="req-th">物料编码</span></template>
          <template #default="{ row }">
            <el-select
              v-model="row.materialId"
              filterable
              remote
              reserve-keyword
              :remote-method="(kw: string) => searchRowMaterials(row, kw)"
              :loading="row.materialLoading"
              placeholder="输入编码/名称搜索"
              style="width: 100%"
              @change="onRowMaterialChange(row)"
            >
              <el-option v-for="m in row.materialOptions" :key="m.id" :label="m.code" :value="m.id">
                <span>{{ m.code }}</span>
                <span style="color: var(--el-text-color-secondary); margin-left: 8px">{{ m.name }}</span>
                <span v-if="m.specification" style="color: var(--el-text-color-secondary); margin-left: 8px">{{ m.specification }}</span>
              </el-option>
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column label="封装" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.packageType || '-' }}</template>
        </el-table-column>
        <el-table-column label="物料描述" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.description || '-' }}</template>
        </el-table-column>
        <el-table-column label="计量单位" width="80">
          <template #default="{ row }">
            <el-select v-model="row.unit" filterable allow-create default-first-option clearable placeholder="基本单位" style="width: 100%">
              <el-option v-for="u in row.unitOptions" :key="u" :label="u" :value="u" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="货位" width="90">
          <template #default="{ row }">
            <el-select v-if="warehouseBinManaged(row.warehouseId)" v-model="row.binId" filterable clearable placeholder="选择货位" style="width: 100%" @change="onRowBinChange(row)">
              <el-option v-for="b in binOptionsFor(row.warehouseId)" :key="b.id" :label="b.name" :value="b.id" />
            </el-select>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="110">
          <template #default="{ row }">
            <el-select v-model="row.batchNo" filterable clearable allow-create default-first-option placeholder=" " style="width: 100%">
              <el-option v-for="b in row.batches" :key="b.batchNo" :label="b.batchNo" :value="b.batchNo" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="80">
          <template #header><span class="req-th">数量</span></template>
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="isRed ? undefined : 0" :precision="2" :controls="false" style="width: 100%" @input="(v: number | undefined) => onQuantityInput(row, v)" @keydown="preventNegativeKey" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="100" align="right">
          <template #default="{ row }">{{ row.material ? rowUnitCost(row).toFixed(6) : '-' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">{{ row.material ? rowAmount(row).toFixed(2) : '-' }}</template>
        </el-table-column>
        <el-table-column label="现存量" width="80" align="right">
          <template #default="{ row }">{{ row.stockQty ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="备注" width="120">
          <template #default="{ row }">
            <el-input v-model="row.remark" placeholder="备注" clearable />
          </template>
        </el-table-column>
      </el-table>
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
/* 明细必填列表头：红 * 前缀 */
.req-th::before {
  content: '*';
  color: var(--erp-red);
  margin-right: 2px;
}
.erp-group {
  border: 1px solid #d5dae2;
  border-radius: 6px;
  padding: 8px 12px 2px;
  margin-bottom: 12px;
  background: #fafbfc;
}

/* 金蝶表头：5 列网格，固定标签宽，列对齐、行距紧凑 */
.kd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  column-gap: 16px;
  row-gap: 2px;
}
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

/* 明细表 Excel 网格风格：细线表格 + 紧凑单元格 + 全幅无边框输入 */
.items-editor {
  --el-table-border-color: var(--erp-hairline);
  --el-table-header-bg-color: var(--el-fill-color-light);
  --el-table-row-hover-bg-color: var(--el-color-primary-light-9);
  border: 1px solid var(--erp-hairline);
}
/* 明细行统一白底 */
.items-editor :deep(.el-table__body tr.el-table__row > td.el-table__cell) {
  background: #fff;
}
.items-editor :deep(.el-table__inner-wrapper::before),
.items-editor :deep(.el-table__inner-wrapper::after),
.items-editor :deep(.el-table__header th.el-table__cell),
.items-editor :deep(.el-table__body td.el-table__cell) {
  border-color: var(--erp-hairline);
}
.items-editor :deep(.el-table__cell) {
  padding: 0;
}
.items-editor :deep(.el-table .cell) {
  padding: 3px 4px;
  line-height: 24px;
}
.items-editor :deep(.el-table th.el-table__cell) {
  height: 28px;
}
.items-editor :deep(.el-table td.el-table__cell) {
  height: 30px;
}
.items-editor :deep(.el-input__wrapper),
.items-editor :deep(.el-select__wrapper) {
  box-shadow: none;
  background: transparent;
  border-radius: 0;
  padding: 0 2px;
  min-height: 24px;
}
.items-editor :deep(.el-input__wrapper:hover),
.items-editor :deep(.el-select__wrapper:hover) {
  box-shadow: none;
}
.items-editor :deep(.el-input__wrapper.is-focus),
.items-editor :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--erp-copper) inset;
  background: var(--el-fill-color-blank);
}
.items-editor :deep(.el-input-number .el-input__inner) {
  text-align: right;
}
.items-editor :deep(.el-input-number__decrease),
.items-editor :deep(.el-input-number__increase) {
  display: none;
}
</style>
