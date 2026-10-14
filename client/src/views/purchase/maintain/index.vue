<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, supplierApi, materialApi } from '../../../api'
import MaterialPickerDialog from '../../../components/MaterialPickerDialog.vue'
import { BASE_LOCATIONS } from '../../../utils/location'

const route = useRoute()
const router = useRouter()

const suppliers = ref<any[]>([])
const materials = ref<any[]>([])
// 每行独立的物料下拉选项（el-select-v2 虚拟滚动），避免各行已选物料混入别人的搜索结果
const materialLoading = ref(false)
const buyerOptions = ref<string[]>([])
const unitOptions = ref<string[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const orderOptions = ref<any[]>([])
const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]
const headerLocation = ref('')
const isEditLoad = ref(false)
const selectedOrderId = ref<number | null>(null)

const itemStatusOptions = [
  { label: '空白', value: 'blank' },
  { label: '关闭', value: 'closed' },
  { label: '取消', value: 'cancelled' },
]

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
]

const form = reactive<any>({ id: null, orderNo: '', supplierId: null, settleMethod: '', orderDate: '', expectedDate: '', buyer: '', taxIncluded: false, taxRate: 0, remark: '', items: [] })

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const settleMethodOptions = ['现金', '月结', '月结30天', '月结60天', '货到付款', '预付款', '其他']

const rules = computed(() => ({
  supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  orderDate: [{ required: true, message: '请选择订货日期', trigger: 'change' }],
  buyer: [{ required: true, message: '请输入采购员', trigger: 'blur' }],
}))

const materialMap = new Map<number, any>()
function registerMaterials(items: any[]) {
  for (const m of items) if (m?.id) materialMap.set(m.id, m)
  materials.value = [...materialMap.values()]
}

// 物料下拉选项结构：编码 + 名称 + 型号规格
function toCodeOption(m: any) {
  return { value: m.id, label: m.code, name: m.name, specification: m.specification || '' }
}

function buildItemOptions() {
  const units = new Set<string>(['张', '个', '套', '台', '件', '只', '米', '千克', '吨', '升', '箱', '包', '卷'])
  const locs = new Map<string, string>()
  for (const l of BASE_LOCATIONS) locs.set(l.code, l.name)
  for (const m of materials.value) {
    if (m.unit) units.add(m.unit)
    if (m.location && !locs.has(m.location)) locs.set(m.location, '')
  }
  unitOptions.value = [...units]
  locationOptions.value = [...locs.entries()].map(([code, name]) => ({ code, name }))
}

// 按关键字搜索物料（不限定类别，编码/名称/型号规格任一命中）；结果只写入当前行的选项
async function searchMaterials(keyword: string, row: any) {
  if (!row) return
  if (!keyword?.trim()) { row.__options = []; return }
  materialLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword: keyword.trim(), limit: 500 })
    const list = res.data || []
    registerMaterials(list)
    buildItemOptions()
    row.__options = list.map(toCodeOption)
  } catch { /* ignore */ } finally { materialLoading.value = false }
}

function onSupplierChange() {
  const s = suppliers.value.find((s) => s.id === form.supplierId)
  if (s?.settleMethod) form.settleMethod = s.settleMethod
  else if (!form.settleMethod) form.settleMethod = ''
  if (s?.buyer && !form.buyer) form.buyer = s.buyer
  if (s) {
    form.taxIncluded = !!s.taxIncluded
    form.taxRate = s.taxRate ?? 0
    for (const it of form.items) { it.taxIncluded = form.taxIncluded; it.taxRate = form.taxRate }
  }
}

function applyLocationToItems() { for (const it of form.items) it.location = headerLocation.value || '' }
function applyExpectedDateToItems() { for (const it of form.items) if (!it.expectedDate) it.expectedDate = form.expectedDate || '' }

function addItem() {
  form.items.push({ id: null, receivedQty: 0, materialId: null, quantity: 1, unit: '', unitPrice: 0, unitPriceText: '', taxIncluded: !!form.taxIncluded, taxRate: form.taxRate ?? 0, location: headerLocation.value || 'A01', expectedDate: form.expectedDate || '', remark: '', status: 'blank', sourceOrderNo: '', __options: [] })
}
const selectedRows = ref<any[]>([])
const itemsTableRef = ref()
function removeSelected() {
  form.items = form.items.filter((it: any) => !selectedRows.value.includes(it))
  selectedRows.value = []
  itemsTableRef.value?.clearSelection()
}

function onMaterialChange(row: any, materialId: number) {
  const m = materials.value.find((x) => x.id === materialId)
  if (!m) return
  if (m.unit) row.unit = m.unit
  row.location = m.location || headerLocation.value || ''
  row.unitPrice = m.cost ?? 0
  row.unitPriceText = m.cost ? String(m.cost) : ''
}
// 名称/型号规格列只读展示：优先取缓存，其次行上加载时带出的 material
function rowMaterialName(row: any): string {
  const m = materialMap.get(row.materialId) || row.material || null
  return m?.name || ''
}
function rowMaterialSpec(row: any): string {
  const m = materialMap.get(row.materialId) || row.material || null
  return m?.specification || ''
}
function onUnitPriceInput(row: any) { const n = Number(row.unitPriceText); row.unitPrice = Number.isNaN(n) ? 0 : n }

// 打开编码下拉时按当前行值过滤：有值→按编码重新搜索；无值→清空选项，避免显示无关结果
function onCodeSelectVisible(open: boolean, row: any) {
  if (!open) return
  const m = materialMap.get(row.materialId)
  if (m?.code) searchMaterials(m.code, row)
  else row.__options = []
}

// 通用物料选择弹窗（混合模式：快捷下拉 + 弹窗浏览）
const pickerVisible = ref(false)
const pickerRowIndex = ref(-1)
function openPicker(row: any) {
  pickerRowIndex.value = form.items.indexOf(row)
  pickerVisible.value = true
}
function onPickMaterial(m: any) {
  const row = form.items[pickerRowIndex.value]
  if (!row || !m) return
  registerMaterials([m])
  row.__options = [toCodeOption(m), ...(row.__options || [])]
  row.materialId = m.id
  onMaterialChange(row, m.id)
  pickerVisible.value = false
}

async function loadBuyers() {
  try {
    const res: any = await purchaseApi.buyers()
    buyerOptions.value = (res.data || []).map((u: any) => u.realName || u.username).filter(Boolean)
  } catch { buyerOptions.value = [] }
}

async function loadOrderOptions() {
  const res: any = await purchaseApi.list({ page: 1, pageSize: 200 })
  orderOptions.value = res.data.items || []
}

const orderQuery = ref('')
const orderFilterOptions = computed(() => {
  const q = orderQuery.value.trim().toLowerCase()
  return orderOptions.value
    .filter((o: any) => !q || `${o.orderNo} ${o.supplier?.name || ''}`.toLowerCase().includes(q))
    .map((o: any) => ({
      value: o.id,
      label: o.orderNo,
      supplier: o.supplier?.name || '未指定',
    }))
})

function filterOrderOptions(val: string) {
  orderQuery.value = val
}

function resetForm() {
  Object.keys(form).forEach((k) => (form[k] = null))
  form.orderDate = todayStr()
  form.expectedDate = ''
  form.buyer = ''
  form.taxIncluded = false
  form.taxRate = 0
  form.items = []
  headerLocation.value = 'A01'
  isEditLoad.value = false
  selectedOrderId.value = null
  snapshot.value = JSON.stringify(buildPayload())
}

async function loadOrder(id: number) {
  const res: any = await purchaseApi.get(id)
  const row = res.data
  Object.assign(form, row)
  form.orderDate = row.orderDate?.slice(0, 10) || ''
  form.expectedDate = row.expectedDate?.slice(0, 10) || ''
  form.buyer = row.buyer || ''
  form.items = row.items?.map((i: any) => ({
    id: i.id,
    receivedQty: i.receivedQty ?? 0,
    materialId: i.materialId,
    quantity: i.quantity,
    unit: i.unit || i.material?.unit || '',
    unitPrice: i.unitPrice,
    unitPriceText: i.unitPrice != null && i.unitPrice !== 0 ? String(i.unitPrice) : '',
    taxIncluded: !!i.taxIncluded,
    taxRate: i.taxRate ?? 0,
    location: i.location || i.material?.location || '',
    expectedDate: i.expectedDate?.slice(0, 10) || '',
    remark: i.remark || '',
    status: i.status || 'blank',
    sourceOrderNo: i.sourceOrderNo || '',
    __options: i.material ? [toCodeOption(i.material)] : [],
  })) || []
  registerMaterials((row.items || []).map((i: any) => i.material).filter(Boolean))
  const locs = new Set<string>((row.items || []).map((i: any) => i.location).filter(Boolean))
  headerLocation.value = locs.size === 1 ? [...locs][0] : ''
  isEditLoad.value = true
  buildItemOptions()
  snapshot.value = JSON.stringify(buildPayload())
}

function buildPayload() {
  return {
    supplierId: form.supplierId,
    settleMethod: form.settleMethod || undefined,
    orderDate: form.orderDate || undefined,
    expectedDate: form.expectedDate || undefined,
    buyer: form.buyer || undefined,
    taxIncluded: !!form.taxIncluded,
    taxRate: form.taxRate ?? 0,
    remark: form.remark,
    items: form.items.map((i: any) => ({
      id: i.id,
      receivedQty: i.receivedQty ?? 0,
      materialId: i.materialId,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: Number(i.unitPriceText) || 0,
      taxIncluded: i.taxIncluded,
      taxRate: i.taxRate,
      location: i.location,
      expectedDate: i.expectedDate,
      remark: i.remark,
      status: i.status === 'blank' ? '' : i.status,
      sourceOrderNo: i.sourceOrderNo,
    })),
  }
}

const snapshot = ref('')
const isDirty = computed(() => snapshot.value !== '' && JSON.stringify(buildPayload()) !== snapshot.value)

async function handleSave() {
  try { await (formRef.value as any).validate() } catch { return false }
  if (form.items.length === 0) { ElMessage.warning('请至少添加一个采购明细'); return false }
  for (const it of form.items) { if (!it.materialId) { ElMessage.warning('请选择物料'); return false } }
  try {
    if (isEditLoad.value) {
      await purchaseApi.update(form.id, buildPayload())
      ElMessage.success('采购单更新成功')
    } else {
      const res: any = await purchaseApi.create(buildPayload())
      ElMessage.success('采购单创建成功')
      form.id = res.data?.id ?? null
      form.orderNo = res.data?.orderNo || ''
      form.status = res.data?.status || ''
      isEditLoad.value = true
      selectedOrderId.value = form.id
    }
    loadOrderOptions()
    snapshot.value = JSON.stringify(buildPayload())
    return true
  } catch {
    return false
  }
}

function handlePrint() {
  skipLeave.value = true
  router.push(`/purchase/print?id=${form.id}`)
}

const leaveDialogVisible = ref(false)
const pendingLeave = ref<null | (() => void)>(null)
const skipLeave = ref(false)

onBeforeRouteLeave((_to, _from, next) => {
  if (skipLeave.value) { skipLeave.value = false; next(); return }
  if (!isDirty.value) { next(); return }
  pendingLeave.value = () => next()
  leaveDialogVisible.value = true
})

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

function onNewClick() {
  if (!isDirty.value) { resetForm(); return }
  pendingLeave.value = () => resetForm()
  leaveDialogVisible.value = true
}

async function saveAndLeave() {
  const ok = await handleSave()
  if (!ok) return
  const go = pendingLeave.value
  pendingLeave.value = null
  leaveDialogVisible.value = false
  go?.()
}

function discardAndLeave() {
  const go = pendingLeave.value
  pendingLeave.value = null
  leaveDialogVisible.value = false
  go?.()
}

function cancelLeave() {
  pendingLeave.value = null
  leaveDialogVisible.value = false
}

onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

async function handleStatusChange(status: string) {
  if (status === form.status) return
  try {
    await purchaseApi.updateStatus(form.id, status)
    ElMessage.success('状态已更新')
    loadOrderOptions()
    if (form.id) loadOrder(form.id)
  } catch { /* error shown */ }
}

async function handleDelete() {
  if (!form.id) return
  try {
    await ElMessageBox.confirm(`确定删除采购单 ${form.orderNo}？仅草稿且无收货记录的采购单可删除。`, '删除采购单', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await purchaseApi.remove(form.id)
    ElMessage.success('采购单已删除')
    resetForm()
    loadOrderOptions()
  } catch { /* error shown */ }
}

const formRef = ref()

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  const [sRes, mRes] = await Promise.all([
    supplierApi.list({ pageSize: 200 }),
    materialApi.options({ limit: 200 }),
  ])
  suppliers.value = sRes.data.items
  registerMaterials(mRes.data || [])
  buildItemOptions()
  loadBuyers()
  loadOrderOptions()
  resetForm()
  const id = Number(route.query.id)
  if (id) { selectedOrderId.value = id; loadOrder(id) }
})

function onOrderSelect(id: number | null) {
  if (id) loadOrder(id)
  else resetForm()
}

async function copyOrderNo() {
  const no = form.orderNo
  if (!no) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(no)
      ElMessage.success('采购单号已复制')
      return
    }
  } catch { /* fall through */ }
  // 非安全上下文（HTTP/局域网访问）Clipboard API 不可用，改用 execCommand 兜底
  try {
    const ta = document.createElement('textarea')
    ta.value = no
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, no.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) ElMessage.success('采购单号已复制')
    else ElMessage.warning('复制失败，请手动选择复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <span style="font-weight: 600">{{ isEditLoad ? '编辑采购单' : '新增采购单' }}</span>

        <el-button style="margin-left: auto" @click="router.push('/purchase/order')">返回采购订单</el-button>
        <el-button @click="onNewClick">新增</el-button>
        <el-button v-if="isEditLoad" type="primary" plain @click="handlePrint">打印</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <div class="erp-group">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="采购单号">
              <div style="display: flex; align-items: center; gap: 8px">
                <el-select-v2 v-model="selectedOrderId" filterable clearable placeholder="选择采购单号编辑，留空为新增" style="width: 280px" :options="orderFilterOptions" :filter-method="filterOrderOptions" @change="(v: any) => onOrderSelect(v)">
                  <template #default="{ item }">
                    <span>{{ item.label }}</span>
                    <span style="color: var(--el-text-color-secondary); margin-left: 8px">{{ item.supplier }}</span>
                  </template>
                </el-select-v2>
                <el-tooltip v-if="form.orderNo" content="复制采购单号">
                  <el-button size="small" text type="primary" @click="copyOrderNo"><el-icon><CopyDocument /></el-icon></el-button>
                </el-tooltip>
                <el-select v-if="form.status" :model-value="form.status" size="small" style="width: 110px" @change="(v: string) => handleStatusChange(v)">
                  <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
                <el-button v-if="form.id && form.status === 'draft'" size="small" type="danger" plain @click="handleDelete">删除</el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="供应商" prop="supplierId">
              <el-select v-model="form.supplierId" filterable style="width: 100%" @change="onSupplierChange">
                <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="结算方式">
              <el-select v-model="form.settleMethod" filterable allow-create default-first-option placeholder="自动带出，可改" style="width: 100%">
                <el-option v-for="m in settleMethodOptions" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="含税">
              <el-checkbox v-model="form.taxIncluded">含税价</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="税率">
              <el-select v-model="form.taxRate" filterable allow-create default-first-option placeholder="税率" style="width: 100%">
                <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}%`" :value="r" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="订货日期" prop="orderDate">
              <el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择订货日期" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="截止日期" prop="expectedDate">
              <el-date-picker v-model="form.expectedDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择截止日期" @change="applyExpectedDateToItems" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="采购员" prop="buyer">
              <el-select v-model="form.buyer" filterable allow-create default-first-option placeholder="选择或输入采购员" style="width: 100%">
                <el-option v-for="b in buyerOptions" :key="b" :label="b" :value="b" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="库位">
              <el-select v-model="headerLocation" clearable filterable allow-create default-first-option placeholder="选择后应用到明细" style="width: 100%" @change="applyLocationToItems">
                <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        </div>

        <div style="width: 100%">
            <el-button size="small" type="primary" plain @click="addItem"><el-icon><Plus /></el-icon>添加明细</el-button>
            <el-button size="small" type="primary" plain style="margin-left: 8px" :disabled="selectedRows.length === 0" @click="removeSelected">删除选中</el-button>
            <el-table ref="itemsTableRef" class="items-editor" :data="form.items" size="small" border style="margin-top: 8px; width: 100%" @selection-change="(v: any[]) => selectedRows = v">
              <el-table-column type="selection" width="45" />
              <el-table-column label="物料编码" min-width="145">
                <template #default="{ row }">
                  <div style="display: flex; align-items: center; gap: 2px">
                    <el-select-v2 v-model="row.materialId" :options="row.__options || []" filterable remote reserve-keyword :remote-method="(q: string) => searchMaterials(q, row)" :loading="materialLoading" placeholder="输入编码搜索" popper-class="mat-code-popper" style="width: 100%; min-width: 0" @visible-change="(open: boolean) => onCodeSelectVisible(open, row)" @change="(v: number) => onMaterialChange(row, v)">
                      <template #default="{ item }">
                        <span>{{ item.label }}</span>
                        <span style="margin-left: 10px; color: var(--el-text-color-secondary)">{{ item.name }}</span>
                        <span v-if="item.specification" style="margin-left: 10px; color: var(--el-text-color-secondary)">{{ item.specification }}</span>
                      </template>
                      <template #empty>
                        <div style="padding: 8px 12px; color: var(--el-text-color-secondary); font-size: 12px">输入编码/名称关键字搜索</div>
                      </template>
                    </el-select-v2>
                    <el-button text size="small" title="打开物料选择器" style="flex-shrink: 0; padding: 2px" @click="openPicker(row)"><el-icon><Search /></el-icon></el-button>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="名称/型号规格" min-width="180">
                <template #default="{ row }">
                  <span>{{ rowMaterialName(row) }}</span>
                  <span v-if="rowMaterialSpec(row)" style="margin-left: 6px; color: var(--el-text-color-secondary)">{{ rowMaterialSpec(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="90">
                <template #default="{ row }">
                  <el-select v-model="row.unit" filterable allow-create default-first-option placeholder="单位" style="width: 100%">
                    <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="85" align="right">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="1" :controls="false" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="单价" width="90" align="right">
                <template #default="{ row }">
                  <el-input v-model="row.unitPriceText" class="num-input" size="small" style="width: 100%" @input="onUnitPriceInput(row)" />
                </template>
              </el-table-column>
              <el-table-column label="金额" width="85" align="right">
                <template #default="{ row }">
                  ¥{{ ((row.quantity || 0) * (row.unitPrice || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
                </template>
              </el-table-column>
              <el-table-column label="含税" width="60" align="center">
                <template #default="{ row }"><el-checkbox v-model="row.taxIncluded" /></template>
              </el-table-column>
              <el-table-column label="税率%" width="95">
                <template #default="{ row }">
                  <el-select v-model="row.taxRate" filterable allow-create default-first-option placeholder="税率" style="width: 100%">
                    <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}`" :value="r" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="库位" width="100">
                <template #default="{ row }">
                  <el-select v-model="row.location" filterable allow-create default-first-option clearable placeholder="库位" style="width: 100%">
                    <el-option v-for="l in locationOptions" :key="l.code" :label="l.name || l.code" :value="l.code" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="截止日期" width="150">
                <template #default="{ row }">
                  <el-input v-model="row.expectedDate" type="date" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="订单号" width="140">
                <template #default="{ row }">
                  <el-input v-model="row.sourceOrderNo" size="small" placeholder="需求来源订单" />
                </template>
              </el-table-column>
              <el-table-column label="状态" width="85">
                <template #default="{ row }">
                  <el-select v-model="row.status" size="small" style="width: 100%">
                    <el-option v-for="o in itemStatusOptions" :key="o.value" :label="row.status === 'blank' && o.value === 'blank' ? '' : o.label" :value="o.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="备注" width="140">
                <template #default="{ row }"><el-input v-model="row.remark" size="small" placeholder="备注" /></template>
              </el-table-column>
            </el-table>
          </div>
        <el-form-item label="备注" label-position="top">
          <el-input v-model="form.remark" type="textarea" :rows="2" style="width: 100%" />
        </el-form-item>
      </el-form>
    </div>

    <MaterialPickerDialog v-model="pickerVisible" @select="onPickMaterial" />

    <el-dialog v-model="leaveDialogVisible" title="未保存的修改" width="420px" :close-on-click-modal="false" :append-to-body="true">
      <div style="line-height: 1.8">当前采购单有未保存的修改，是否保存后离开？</div>
      <template #footer>
        <el-button @click="cancelLeave">取消</el-button>
        <el-button @click="discardAndLeave">不保存</el-button>
        <el-button type="primary" @click="saveAndLeave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.erp-group {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 14px 16px 4px;
  margin-bottom: 16px;
}
.erp-group-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

/* 明细表 Excel 网格风格：细线表格 + 紧凑单元格 + 全幅无边框输入，聚焦铜色选中感 */
.items-editor {
  --el-table-border-color: var(--erp-hairline);
  --el-table-header-bg-color: var(--el-fill-color-light);
  --el-table-row-hover-bg-color: var(--el-color-primary-light-9);
  border: 1px solid var(--erp-hairline);
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
/* 单元格内控件：占满、无内边距、无圆角 */
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
.items-editor :deep(.num-input .el-input__inner) {
  text-align: right;
}
</style>

<style>
/* 物料下拉浮层固定加宽（浮层 teleport 到 body，需非 scoped；浮层内宽度为内联样式，须 !important 覆盖） */
.mat-code-popper .el-select-dropdown,
.mat-code-popper .el-select-dropdown .el-vl__wrapper,
.mat-code-popper .el-vl__window,
.mat-code-popper .el-select-dropdown__item {
  width: 100% !important;
}
.mat-code-popper .el-select-dropdown {
  min-width: 480px !important;
  width: 480px !important;
}
</style>
