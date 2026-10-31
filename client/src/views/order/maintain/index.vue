<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage } from 'element-plus'
import { orderApi, materialApi, customerApi, systemApi } from '../../../api'
import MaterialPickerDialog from '../../../components/MaterialPickerDialog.vue'

const route = useRoute()
const router = useRouter()

const customers = ref<any[]>([])
const materials = ref<any[]>([])
const materialLoading = ref(false)
const userOptions = ref<string[]>([])
const unitOptions = ref<string[]>([])
const orderOptions = ref<any[]>([])
const orderLoading = ref(false)
const pageLoading = ref(false)
// 客户列表变化不频繁：模块级缓存（60s），重复进入编辑页不再重复拉取
let customerCache: any[] | null = null
let customerCacheAt = 0
const CUSTOMER_CACHE_TTL = 60 * 1000
const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]
const paymentOptions = ['款到发货', '货到付款', '预付款', '月结30天', '银行转账', '电汇', '承兑汇票']
const editableStatuses = ['draft', 'confirmed', 'in_production']

const isEditLoad = ref(false)
const selectedOrderId = ref<number | null>(null)
const formRef = ref()

const statusLabelMap: Record<string, string> = {
  draft: '草稿', confirmed: '已确认', in_production: '生产中', completed: '已完工', shipped: '已发货', cancelled: '已取消',
}
const statusTypeMap: Record<string, string> = {
  draft: 'info', confirmed: 'primary', in_production: 'warning', completed: 'success', shipped: 'info', cancelled: 'danger',
}

const form = reactive<any>({
  id: null,
  orderNo: '',
  customerId: null,
  customerCode: '',
  customerName: '',
  orderDate: '',
  channel: '',
  seller1: '',
  seller2: '',
  paymentMethod: '',
  taxIncluded: false,
  taxRate: 0,
  deliveryDate: '',
  status: '',
  remark: '',
  items: [],
})

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function validateDeliveryDate(_rule: any, value: string, callback: (e?: Error) => void) {
  if (value && form.orderDate && value < form.orderDate) {
    callback(new Error('交货日期不能早于订货日期'))
  } else {
    callback()
  }
}

const rules = computed(() => ({
  customerId: [{ required: true, message: '请选择客户', trigger: 'change' }],
  orderDate: [{ required: true, message: '请选择订货日期', trigger: 'change' }],
  seller1: [{ required: true, message: '请选择销售员1', trigger: 'change' }],
  deliveryDate: [
    { required: true, message: '请选择交货日期', trigger: 'change' },
    { validator: validateDeliveryDate, trigger: 'change' },
  ],
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

function buildUnitOptions() {
  const units = new Set<string>(['个', '件', '套', '台', '只', '箱', '包', '卷', '米', '千克', '吨', '升', '张'])
  for (const m of materials.value) if (m.unit) units.add(m.unit)
  unitOptions.value = [...units]
}

// 按关键字搜索物料（编码/名称/型号规格任一命中）；结果只写入当前行的选项
async function searchMaterials(keyword: string, row: any) {
  if (!row) return
  if (!keyword?.trim()) { row.__options = []; return }
  materialLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword: keyword.trim(), limit: 500 })
    const list = res.data || []
    registerMaterials(list)
    buildUnitOptions()
    row.__options = list.map(toCodeOption)
  } catch { /* ignore */ } finally { materialLoading.value = false }
}

function onMaterialChange(row: any, materialId: number) {
  const m = materialMap.get(materialId) || materials.value.find((x) => x.id === materialId)
  if (!m) return
  row.material = m
  if (m.unit) row.unit = m.unit
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
// 单据行可选计量单位：物料基本单位 + 已维护的转换单位（含当前行单位）
function rowUnitOptions(row: any): string[] {
  const m = materialMap.get(row.materialId) || row.material || null
  const set = new Set<string>(unitOptions.value)
  if (m?.units) for (const u of m.units) set.add(u)
  if (row.unit) set.add(row.unit)
  return [...set]
}
// 换算提示：录入单位≠基本单位时，显示折算后的基本单位数量
function rowBaseHint(row: any): string {
  const m = materialMap.get(row.materialId) || row.material || null
  if (!m?.unit) return ''
  const u = row.unit || m.unit
  if (u === m.unit) return ''
  const rate = m.unitRates?.[u] ?? 0
  if (!rate) return ''
  const base = (Number(row.quantity) || 0) * rate
  return `= ${Number(base.toFixed(6))} ${m.unit}`
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

// 行选择：点击行即选中，配合“删除选中”使用
const currentRow = ref<any | null>(null)
const itemsTableRef = ref()
function onCurrentChange(row: any | null) { currentRow.value = row }
// 捕获阶段处理：行内控件（下拉/输入框）会 stopPropagation，用 capture 保证点击任意位置都能选中该行
function onTableClickCapture(e: MouseEvent) {
  const tr = (e.target as HTMLElement)?.closest('tr') as HTMLTableRowElement | null
  if (!tr || !tr.closest('.el-table__body')) return
  const row = form.items[tr.rowIndex]
  if (row) { currentRow.value = row; itemsTableRef.value?.setCurrentRow(row) }
}
// 点击选中一行后删除；有发运记录的行禁止删除
function removeSelected() {
  if (!currentRow.value) { ElMessage.warning('请先点击选择一行'); return }
  if ((currentRow.value.deliveredQty || 0) > 0) { ElMessage.warning('有发运记录的行不能删除'); return }
  form.items = form.items.filter((it: any) => it !== currentRow.value)
  currentRow.value = null
  itemsTableRef.value?.setCurrentRow()
}

function nextLine(): number {
  return form.items.reduce((m: number, it: any) => Math.max(m, Number(it.line) || 0), 0) + 1
}
function addItem() {
  form.items.push({
    id: null, line: nextLine(), materialId: null, quantity: 1, deliveredQty: 0,
    unit: '', unitPrice: 0, unitPriceText: '', taxIncluded: !!form.taxIncluded, taxRate: Number(form.taxRate) || 0,
    deliveryDate: form.deliveryDate || '', __options: [],
  })
}

function onCustomerChange(val: any) {
  const c = customers.value.find((x) => x.id === val)
  if (c) {
    form.customerName = c.name
    form.customerCode = c.code
    if (c.seller) form.seller1 = c.seller
    if (c.settleMethod) form.paymentMethod = c.settleMethod
    form.taxIncluded = !!c.taxIncluded
    form.taxRate = Number(c.taxRate) || 0
    syncHeaderTaxToItems()
  }
}

const prevDeliveryDate = ref('')
// 主表含税/税率联动：与旧主表默认值相同的明细行跟随更新（口径同交期联动）
const prevHeaderTax = ref({ included: false, rate: 0 })
function syncHeaderTaxToItems() {
  const prev = prevHeaderTax.value
  for (const it of form.items) {
    if (!!it.taxIncluded === prev.included && (Number(it.taxRate) || 0) === prev.rate) {
      it.taxIncluded = !!form.taxIncluded
      it.taxRate = Number(form.taxRate) || 0
    }
  }
  prevHeaderTax.value = { included: !!form.taxIncluded, rate: Number(form.taxRate) || 0 }
}
function onHeaderTaxChange() {
  syncHeaderTaxToItems()
}
function onDeliveryDateChange(val: string) {
  for (const item of form.items) {
    if (!item.deliveryDate || item.deliveryDate === prevDeliveryDate.value) item.deliveryDate = val || ''
  }
  prevDeliveryDate.value = val || ''
}
function onOrderDateChange() {
  if (form.deliveryDate && form.orderDate && form.deliveryDate < form.orderDate) form.deliveryDate = form.orderDate
}

const customerFilter = ref('')
const filteredCustomers = computed(() => {
  const q = customerFilter.value.trim().toLowerCase()
  if (!q) return customers.value
  const list = customers.value.filter(
    (c: any) => String(c.code || '').toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q),
  )
  const selected = customers.value.find((c: any) => c.id === form.customerId)
  if (selected && !list.includes(selected)) list.unshift(selected)
  return list
})
function filterCustomerMethod(query: string) { customerFilter.value = query }
function onCustomerVisible(visible: boolean) { if (!visible) customerFilter.value = '' }

async function loadSellers() {
  try {
    const res: any = await systemApi.salespersons()
    const items: any[] = res.data?.items || res.data || []
    userOptions.value = [...new Set(items.map((u: any) => u.realName || u.username).filter(Boolean))]
  } catch { userOptions.value = [] }
}

async function loadCustomers() {
  if (customerCache && Date.now() - customerCacheAt < CUSTOMER_CACHE_TTL) { customers.value = customerCache; return }
  const res: any = await customerApi.list({ pageSize: 200 })
  const items = res.data?.items || []
  customerCache = items
  customerCacheAt = Date.now()
  customers.value = items
}

async function loadOrderOptions(keyword = '') {
  orderLoading.value = true
  try {
    const res: any = await orderApi.options({ keyword: keyword || undefined, limit: 50 })
    const fetched = (res.data || []).filter((o: any) => editableStatuses.includes(o.status))
    // 无关键字时保留当前编辑单据，避免旧单不在最近 50 条内导致单号下拉空白
    if (!keyword && form.id && !fetched.some((o: any) => o.id === form.id)) {
      fetched.unshift({ id: form.id, orderNo: form.orderNo, customer: form.customerName || '未指定', status: form.status })
    }
    orderOptions.value = fetched
  } catch { orderOptions.value = [] } finally { orderLoading.value = false }
}

const orderFilterOptions = computed(() =>
  orderOptions.value.map((o: any) => ({
    value: o.id,
    label: o.orderNo,
    customer: o.customer || '未指定',
  }))
)

// 编辑单据时确保当前单号在选项中（可能不在最近 50 条内），否则下拉框显示空白
function ensureOrderOption(order: any) {
  if (!order?.id) return
  if (orderOptions.value.some((o: any) => o.id === order.id)) return
  orderOptions.value = [{ id: order.id, orderNo: order.orderNo, customer: order.customerName || '未指定', status: order.status }, ...orderOptions.value]
}

function resetForm() {
  Object.keys(form).forEach((k) => (form[k] = null))
  form.orderDate = todayStr()
  form.deliveryDate = ''
  form.seller1 = ''
  form.seller2 = ''
  form.channel = ''
  form.paymentMethod = ''
  form.taxIncluded = false
  form.taxRate = 0
  prevHeaderTax.value = { included: false, rate: 0 }
  form.items = []
  isEditLoad.value = false
  selectedOrderId.value = null
  snapshot.value = JSON.stringify(buildPayload())
  formRef.value?.clearValidate()
}

async function loadOrder(id: number) {
  pageLoading.value = true
  try {
    const res: any = await orderApi.get(id)
    const row = res.data
    ensureOrderOption(row)
    Object.assign(form, row)
    form.orderDate = row.orderDate?.slice(0, 10) || ''
    form.deliveryDate = row.deliveryDate?.slice(0, 10) || ''
    form.taxIncluded = !!row.taxIncluded
    form.taxRate = Number(row.taxRate) || 0
    prevHeaderTax.value = { included: form.taxIncluded, rate: form.taxRate }
    form.items = (row.items || []).map((i: any, idx: number) => ({
      id: i.id,
      line: Number(i.line) > 0 ? Number(i.line) : idx + 1,
      materialId: i.materialId,
      quantity: i.quantity,
      deliveredQty: i.deliveredQty ?? 0,
      unit: i.unit || i.material?.unit || '',
      unitPrice: i.unitPrice ?? 0,
      unitPriceText: i.unitPrice != null && i.unitPrice !== 0 ? String(i.unitPrice) : '',
      taxIncluded: !!i.taxIncluded,
      taxRate: i.taxRate ?? 0,
      deliveryDate: i.deliveryDate ? String(i.deliveryDate).slice(0, 10) : form.deliveryDate,
      material: i.material,
      __options: i.material ? [toCodeOption(i.material)] : [],
    }))
    registerMaterials((row.items || []).map((i: any) => i.material).filter(Boolean))
    isEditLoad.value = true
    buildUnitOptions()
    snapshot.value = JSON.stringify(buildPayload())
    formRef.value?.clearValidate()
  } finally {
    pageLoading.value = false
  }
}

function buildPayload() {
  return {
    customerId: form.customerId,
    customerCode: form.customerCode,
    customerName: form.customerName,
    orderDate: form.orderDate,
    channel: form.channel,
    seller1: form.seller1,
    seller2: form.seller2,
    paymentMethod: form.paymentMethod,
    taxIncluded: Boolean(form.taxIncluded),
    taxRate: Number(form.taxRate) || 0,
    deliveryDate: form.deliveryDate,
    remark: form.remark,
    items: form.items.map((i: any) => ({
      id: i.id ?? undefined,
      line: Number(i.line) || 0,
      materialId: i.materialId,
      quantity: i.quantity,
      unit: i.unit || '',
      unitPrice: Number(i.unitPriceText) || 0,
      taxIncluded: Boolean(i.taxIncluded),
      taxRate: Number(i.taxRate) || 0,
      deliveryDate: i.deliveryDate || '',
    })),
  }
}

const snapshot = ref('')
const isDirty = computed(() => snapshot.value !== '' && JSON.stringify(buildPayload()) !== snapshot.value)

async function handleSave() {
  try { await (formRef.value as any).validate() } catch { return false }
  if (form.items.length === 0) { ElMessage.warning('请至少添加一个产品'); return false }
  for (const it of form.items) {
    if (!Number.isInteger(Number(it.line)) || Number(it.line) < 1) { ElMessage.warning('请填写明细行号（正整数）'); return false }
    if (!it.materialId) { ElMessage.warning('请选择产品物料'); return false }
    if (!it.deliveryDate) { ElMessage.warning('请填写明细交货日期'); return false }
  }
  try {
    if (isEditLoad.value) {
      await orderApi.update(form.id, buildPayload())
      ElMessage.success('销售订单更新成功')
      await loadOrder(form.id)
    } else {
      const res: any = await orderApi.create(buildPayload())
      ElMessage.success('新增销售订单成功（已确认）')
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
  router.push(`/order/print?id=${form.id}`)
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

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  // 先立即加载单据，主表/明细不被下拉数据阻塞
  const id = Number(route.query.id)
  if (id) { selectedOrderId.value = id; loadOrder(id) } else { resetForm() }
  // 下拉数据并行加载，不阻塞表单显示
  loadCustomers().catch(() => {})
  loadSellers()
  loadOrderOptions()
  materialApi.options({ limit: 200 })
    .then((res: any) => { registerMaterials(res.data || []); buildUnitOptions() })
    .catch(() => {})
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
      ElMessage.success('销售单号已复制')
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
    if (ok) ElMessage.success('销售单号已复制')
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
        <span style="font-weight: 600">{{ isEditLoad ? '编辑销售订单' : '新增销售订单' }}</span>

        <el-button style="margin-left: auto" @click="router.push('/order/sales')">返回销售订单</el-button>
        <el-button @click="onNewClick">新增</el-button>
        <el-button v-if="isEditLoad" type="primary" plain @click="handlePrint">打印</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </div>

      <el-form ref="formRef" v-loading="pageLoading" :model="form" :rules="rules" label-width="72px" class="kd-header-form">
        <div class="erp-group">
          <div class="kd-grid">
            <div class="kd-field">
              <el-form-item label="销售单号">
                <div class="kd-inline kd-order-no">
                  <el-select-v2 v-model="selectedOrderId" filterable remote reserve-keyword clearable placeholder="输入单号/客户搜索，留空为新增" class="kd-flex" :options="orderFilterOptions" :remote-method="loadOrderOptions" :loading="orderLoading" @visible-change="(open: boolean) => open && loadOrderOptions('')" @change="(v: any) => onOrderSelect(v)">
                    <template #default="{ item }">
                      <span>{{ item.label }}</span>
                      <span style="color: var(--el-text-color-secondary); margin-left: 8px">{{ item.customer }}</span>
                    </template>
                  </el-select-v2>
                  <el-tooltip v-if="form.orderNo" content="复制销售单号">
                    <el-button size="small" text type="primary" class="kd-copy-btn" @click="copyOrderNo"><el-icon><CopyDocument /></el-icon></el-button>
                  </el-tooltip>
                </div>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="状态">
                <el-tag v-if="form.status" :type="statusTypeMap[form.status] || 'info'">{{ statusLabelMap[form.status] || form.status }}</el-tag>
                <span v-else class="kd-muted">—</span>
              </el-form-item>
            </div>
            <div class="kd-field kd-field-span3" aria-hidden="true"></div>

            <div class="kd-field">
              <el-form-item label="客户" prop="customerId">
                <el-select v-model="form.customerId" filterable :filter-method="filterCustomerMethod" class="kd-flex" @change="onCustomerChange" @visible-change="onCustomerVisible">
                  <el-option v-for="c in filteredCustomers" :key="c.id" :label="c.code" :value="c.id">
                    <span>{{ c.code }}</span>
                    <span style="margin-left: 10px; color: var(--el-text-color-secondary)">{{ c.name }}</span>
                  </el-option>
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="客户名称">
                <span class="kd-customer-name" :title="form.customerName">{{ form.customerName || '—' }}</span>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="订货日期" prop="orderDate">
                <el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD" class="kd-flex" placeholder="选择订货日期" @change="onOrderDateChange" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="交货日期" prop="deliveryDate">
                <el-date-picker v-model="form.deliveryDate" type="date" value-format="YYYY-MM-DD" class="kd-flex" placeholder="选择交货日期" @change="onDeliveryDateChange" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="销售员1" prop="seller1">
                <el-select v-model="form.seller1" filterable allow-create default-first-option placeholder="选择或输入销售员" class="kd-flex">
                  <el-option v-for="s in userOptions" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </div>

            <div class="kd-field">
              <el-form-item label="结算方式">
                <el-select v-model="form.paymentMethod" filterable allow-create default-first-option placeholder="选择或输入" class="kd-flex">
                  <el-option v-for="p in paymentOptions" :key="p" :label="p" :value="p" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="渠道">
                <el-input v-model="form.channel" placeholder="如：线上/展会/代理" />
              </el-form-item>
            </div>
            <div class="kd-field kd-field-remark">
              <el-form-item label="备注">
                <el-input v-model="form.remark" placeholder="备注" />
              </el-form-item>
            </div>

            <div class="kd-field">
              <el-form-item label="含税">
                <el-checkbox v-model="form.taxIncluded" @change="onHeaderTaxChange">默认含税价</el-checkbox>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="税率">
                <el-select v-model="form.taxRate" filterable allow-create default-first-option placeholder="默认税率" class="kd-flex" @change="onHeaderTaxChange">
                  <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}%`" :value="r" />
                </el-select>
              </el-form-item>
            </div>
          </div>
        </div>

        <div style="width: 100%">
            <el-button size="small" type="primary" plain @click="addItem"><el-icon><Plus /></el-icon>添加明细</el-button>
            <el-button size="small" type="primary" plain style="margin-left: 8px" :disabled="!currentRow" @click="removeSelected">删除选中</el-button>
            <el-table ref="itemsTableRef" class="items-editor" :data="form.items" size="small" border style="margin-top: 8px; width: 100%" highlight-current-row @current-change="onCurrentChange" @click.capture="onTableClickCapture">
              <el-table-column label="行" width="52" align="center">
                <template #default="{ row }">
                  <el-input-number v-model="row.line" :min="1" :step="1" :precision="0" :controls="false" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="产品编码" min-width="110">
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
              <el-table-column label="名称/型号规格" min-width="240">
                <template #default="{ row }">
                  <span>{{ rowMaterialName(row) }}</span>
                  <span v-if="rowMaterialSpec(row)" style="margin-left: 6px; color: var(--el-text-color-secondary)">{{ rowMaterialSpec(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="90">
                <template #default="{ row }">
                  <el-select v-model="row.unit" filterable allow-create default-first-option placeholder="单位" style="width: 100%">
                    <el-option v-for="u in rowUnitOptions(row)" :key="u" :label="u" :value="u" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="85" align="right">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="Math.max(1, row.deliveredQty || 0)" :controls="false" style="width: 100%" />
                  <div v-if="rowBaseHint(row)" class="unit-hint">{{ rowBaseHint(row) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="已发量" width="76" align="right">
                <template #default="{ row }">
                  <span :class="{ 'delivered-qty': (row.deliveredQty || 0) > 0 }">{{ row.deliveredQty || '-' }}</span>
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
              <el-table-column label="交货日期" width="150">
                <template #default="{ row }">
                  <el-input v-model="row.deliveryDate" type="date" size="small" style="width: 100%" />
                </template>
              </el-table-column>
            </el-table>
          </div>
      </el-form>
    </div>

    <MaterialPickerDialog v-model="pickerVisible" @select="onPickMaterial" />

    <el-dialog v-model="leaveDialogVisible" title="未保存的修改" width="420px" :close-on-click-modal="false" :append-to-body="true">
      <div style="line-height: 1.8">当前销售订单有未保存的修改，是否保存后离开？</div>
      <template #footer>
        <el-button @click="cancelLeave">取消</el-button>
        <el-button @click="discardAndLeave">不保存</el-button>
        <el-button type="primary" @click="saveAndLeave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.unit-hint {
  font-size: 11px;
  line-height: 1.2;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.delivered-qty {
  color: var(--el-color-warning);
  font-weight: 600;
}
.erp-group {
  border: 1px solid #D5DAE2;
  border-radius: 6px;
  padding: 8px 12px 2px;
  margin-bottom: 12px;
  background: #fff;
}
.erp-group-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

/* 金蝶表头：3 行 5 列网格，固定标签宽，列对齐、行距紧凑 */
.kd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  column-gap: 16px;
  row-gap: 2px;
}
.kd-field-span2 { grid-column: span 2; }
.kd-field-span3 { grid-column: span 3; }
.kd-field-remark { grid-column: 3 / 6; }
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
.kd-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 销售单号：下拉占满整格（与客户同宽），复制按钮浮在右侧不占宽度 */
.kd-order-no {
  position: relative;
  width: 100%;
}
.kd-order-no :deep(.el-select__wrapper) {
  padding-right: 26px;
}
.kd-order-no .kd-copy-btn {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
}
.kd-flex {
  width: 100%;
}
.kd-muted {
  color: var(--el-text-color-secondary);
}
.kd-customer-name {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
/* 下拉/日期图标与文本对齐，去掉浮起阴影 */
.erp-group :deep(.el-select__caret),
.erp-group :deep(.el-input__icon) {
  color: var(--el-text-color-secondary);
}
.erp-group :deep(.el-input__wrapper.is-focus .el-input__icon),
.erp-group :deep(.el-select__wrapper.is-focused .el-select__caret) {
  color: var(--erp-copper);
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
