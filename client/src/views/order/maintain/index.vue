<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage } from 'element-plus'
import { orderApi, materialApi, customerApi, systemApi } from '../../../api'

const route = useRoute()
const router = useRouter()

const customerOptions = ref<any[]>([])
const products = ref<any[]>([])
const loadingProducts = ref(false)
const userOptions = ref<string[]>([])
const orderOptions = ref<any[]>([])
const isEditLoad = ref(false)
const selectedOrderId = ref<number | null>(null)
const formRef = ref()

const paymentOptions = ['款到发货', '货到付款', '预付款', '月结30天', '银行转账', '电汇', '承兑汇票']
const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]
const editableStatuses = ['draft', 'confirmed', 'in_production']

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
  customerName: [{ required: true, message: '请选择客户', trigger: 'change' }],
  orderDate: [{ required: true, message: '请选择订货日期', trigger: 'change' }],
  seller1: [{ required: true, message: '请选择销售员1', trigger: 'change' }],
  deliveryDate: [
    { required: true, message: '请选择交货日期', trigger: 'change' },
    { validator: validateDeliveryDate, trigger: 'change' },
  ],
}))

const statusLabelMap: Record<string, string> = {
  draft: '草稿', confirmed: '已确认', in_production: '生产中', completed: '已完工', shipped: '已发货', cancelled: '已取消',
}

const statusTypeMap: Record<string, string> = {
  draft: 'info', confirmed: 'primary', in_production: 'warning', completed: 'success', shipped: 'info', cancelled: 'danger',
}

async function loadSellers() {
  try {
    const res: any = await systemApi.salespersons()
    const items: any[] = res.data?.items || res.data || []
    userOptions.value = [...new Set(items.map((u: any) => u.realName || u.username).filter(Boolean))]
  } catch {
    userOptions.value = []
  }
}

async function loadCustomers() {
  const res: any = await customerApi.list({ pageSize: 200 })
  customerOptions.value = res.data.items
}

async function searchProducts(keyword?: string) {
  loadingProducts.value = true
  try {
    const res: any = await materialApi.list({ page: 1, pageSize: 50, keyword: keyword || '' })
    const items: any[] = res.data.items || []
    const selectedIds = new Set(form.items.map((i: any) => i.materialId).filter(Boolean))
    const selected = [
      ...products.value,
      ...form.items.map((i: any) => i.material).filter(Boolean),
    ].filter((p: any) => selectedIds.has(p.id))
    const map = new Map([...selected, ...items].map((p: any) => [p.id, p]))
    products.value = [...map.values()]
  } finally {
    loadingProducts.value = false
  }
}

async function loadOrderOptions() {
  const res: any = await orderApi.list({ page: 1, pageSize: 200 })
  orderOptions.value = (res.data.items || []).filter((o: any) => editableStatuses.includes(o.status))
}

const orderQuery = ref('')
const orderFilterOptions = computed(() => {
  const q = orderQuery.value.trim().toLowerCase()
  return orderOptions.value
    .filter((o: any) => !q || `${o.orderNo} ${o.customerName || ''}`.toLowerCase().includes(q))
    .map((o: any) => ({
      value: o.id,
      label: o.orderNo,
      customer: o.customerName || '未指定客户',
    }))
})

function filterOrderOptions(val: string) {
  orderQuery.value = val
}

function resetForm() {
  Object.keys(form).forEach((k) => (form[k] = null))
  form.orderDate = todayStr()
  form.deliveryDate = ''
  form.seller1 = ''
  form.seller2 = ''
  form.channel = ''
  form.paymentMethod = ''
  form.items = []
  isEditLoad.value = false
  selectedOrderId.value = null
  snapshot.value = JSON.stringify(buildPayload())
  formRef.value?.clearValidate()
}

async function loadOrder(id: number) {
  const res: any = await orderApi.get(id)
  const row = res.data
  Object.assign(form, row)
  form.orderDate = row.orderDate?.slice(0, 10) || ''
  form.deliveryDate = row.deliveryDate?.slice(0, 10) || ''
  form.items = (row.items || []).map((i: any) => ({
    id: i.id,
    materialId: i.materialId,
    quantity: i.quantity,
    unit: i.unit || i.material?.unit || '',
    unitPrice: i.unitPrice ?? 0,
    taxIncluded: !!i.taxIncluded,
    taxRate: i.taxRate ?? 0,
    deliveryDate: i.deliveryDate ? String(i.deliveryDate).slice(0, 10) : form.deliveryDate,
    material: i.material,
  }))
  const selected = (row.items || []).map((i: any) => i.material).filter(Boolean)
  const map = new Map([...products.value, ...selected].map((p: any) => [p.id, p]))
  products.value = [...map.values()]
  isEditLoad.value = true
  customerFilter.value = ''
  snapshot.value = JSON.stringify(buildPayload())
  formRef.value?.clearValidate()
}

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

const customerFilter = ref('')
const filteredCustomers = computed(() => {
  const q = customerFilter.value.trim().toLowerCase()
  if (!q) return customerOptions.value
  const list = customerOptions.value.filter(
    (c: any) => String(c.code || '').toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q),
  )
  const selected = customerOptions.value.find((c: any) => c.id === form.customerId)
  if (selected && !list.includes(selected)) list.unshift(selected)
  return list
})

function filterCustomerMethod(query: string) {
  customerFilter.value = query
}

function onCustomerVisible(visible: boolean) {
  if (!visible) customerFilter.value = ''
}

function onCustomerChange(val: any) {
  const c = customerOptions.value.find((x) => x.id === val)
  if (c) {
    form.customerName = c.name
    form.customerCode = c.code
  }
}

function addItem() {
  form.items.push({ materialId: null, quantity: 1, unitPrice: 0, unit: '', deliveryDate: form.deliveryDate || '', taxIncluded: false, taxRate: 0 })
}

const prevDeliveryDate = ref('')
function onDeliveryDateChange(val: string) {
  for (const item of form.items) {
    if (!item.deliveryDate || item.deliveryDate === prevDeliveryDate.value) item.deliveryDate = val || ''
  }
  prevDeliveryDate.value = val || ''
}

function onOrderDateChange() {
  if (form.deliveryDate && form.deliveryDate < form.orderDate) form.deliveryDate = form.orderDate
}

function onProductChange(row: any, materialId: number) {
  const m = products.value.find((p) => p.id === materialId)
  if (m) {
    row.material = m
    if (m.unit) row.unit = m.unit
  }
}

// 单据行可选计量单位：产品基本单位 + 已维护的转换单位（含当前行单位）
function rowUnitOptions(row: any): string[] {
  const m = products.value.find((p) => p.id === row.materialId) || row.material || null
  const set = new Set<string>(['个', '件', '套', '台', '只', '箱', '包'])
  if (m?.units) for (const u of m.units) set.add(u)
  if (row.unit) set.add(row.unit)
  return [...set]
}
// 换算提示：录入单位≠基本单位时显示折算后的基本单位数量
function rowBaseHint(row: any): string {
  const m = products.value.find((p) => p.id === row.materialId) || row.material || null
  if (!m?.unit) return ''
  const u = row.unit || m.unit
  if (u === m.unit) return ''
  const rate = m.unitRates?.[u] ?? 0
  if (!rate) return ''
  const base = (Number(row.quantity) || 0) * rate
  return `= ${Number(base.toFixed(6))} ${m.unit}`
}

function taxAmountOf(row: any) {
  const qty = Number(row.quantity || 0)
  const price = Number(row.unitPrice || 0)
  const rate = Number(row.taxRate || 0) / 100
  const gross = row.taxIncluded ? price * qty : price * qty * (1 + rate)
  return `¥${gross.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function removeItem(index: number) {
  form.items.splice(index, 1)
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
    deliveryDate: form.deliveryDate,
    remark: form.remark,
    items: form.items.map((i: any) => ({
      materialId: i.materialId,
      quantity: i.quantity,
      unit: i.unit || '',
      unitPrice: i.unitPrice,
      taxIncluded: Boolean(i.taxIncluded),
      taxRate: Number(i.taxRate) || 0,
      deliveryDate: i.deliveryDate || '',
    })),
  }
}

const snapshot = ref('')
const isDirty = computed(() => snapshot.value !== '' && JSON.stringify(buildPayload()) !== snapshot.value)

async function handleSave() {
  try { await formRef.value.validate() } catch { return false }
  if (form.items.length === 0) {
    ElMessage.warning('请至少添加一个产品')
    return false
  }
  for (const item of form.items) {
    if (!item.materialId) {
      ElMessage.warning('请选择产品物料')
      return false
    }
    if (!item.deliveryDate) {
      ElMessage.warning('请填写明细交货日期')
      return false
    }
  }
  try {
    if (isEditLoad.value) {
      await orderApi.update(form.id, buildPayload())
      ElMessage.success('销售订单更新成功')
    } else {
      const res: any = await orderApi.create(buildPayload())
      ElMessage.success('新增销售订单成功（已确认）')
      form.id = res.data?.id ?? null
      form.orderNo = res.data?.orderNo || ''
      isEditLoad.value = true
      selectedOrderId.value = form.id
      loadOrder(form.id)
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

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await Promise.all([loadCustomers(), loadOrderOptions(), loadSellers()])
  await searchProducts('')
  resetForm()
  const id = Number(route.query.id)
  if (id) { selectedOrderId.value = id; loadOrder(id) }
})
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

      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="销售单号">
              <div style="display: flex; align-items: center; gap: 8px">
                <el-select-v2 v-model="selectedOrderId" filterable clearable placeholder="选择销售订单编辑，留空为新增" style="width: 300px" :options="orderFilterOptions" :filter-method="filterOrderOptions" @change="(v: any) => onOrderSelect(v)">
                  <template #default="{ item }">
                    <span>{{ item.label }}</span>
                    <span style="color: var(--el-text-color-secondary); margin-left: 8px">{{ item.customer }}</span>
                  </template>
                </el-select-v2>
                <el-tooltip v-if="form.orderNo" content="复制销售单号">
                  <el-button size="small" text type="primary" @click="copyOrderNo"><el-icon><CopyDocument /></el-icon></el-button>
                </el-tooltip>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-tag v-if="form.status" :type="statusTypeMap[form.status] || 'info'">{{ statusLabelMap[form.status] || form.status }}</el-tag>
              <span v-else class="text-muted">—</span>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="erp-group">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="客户" prop="customerName">
                <el-select
                  v-model="form.customerId"
                  filterable
                  :filter-method="filterCustomerMethod"
                  :validate-event="false"
                  style="width: 100%"
                  @change="onCustomerChange"
                  @visible-change="onCustomerVisible"
                >
                  <el-option v-for="c in filteredCustomers" :key="c.id" :label="c.code" :value="c.id">
                    <span>{{ c.code }}</span>
                    <span style="margin-left: 10px; color: #909399">{{ c.name }}</span>
                  </el-option>
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="客户名称">
                <el-tag v-if="form.customerName" type="info">{{ form.customerName }}</el-tag>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="订货日期" prop="orderDate">
                <el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD" :validate-event="false" style="width: 100%" placeholder="选择订货日期" @change="onOrderDateChange" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="渠道">
                <el-input v-model="form.channel" placeholder="自定义输入，如：线上/展会/代理" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="销售员1" prop="seller1">
                <el-select v-model="form.seller1" filterable :validate-event="false" placeholder="选择销售员" style="width: 100%">
                  <el-option v-for="s in userOptions" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="销售员2" prop="seller2">
                <el-select v-model="form.seller2" filterable clearable placeholder="选择销售员" style="width: 100%">
                  <el-option v-for="s in userOptions" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="结算方式">
                <el-select v-model="form.paymentMethod" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                  <el-option v-for="p in paymentOptions" :key="p" :label="p" :value="p" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="交货日期" prop="deliveryDate">
                <el-date-picker v-model="form.deliveryDate" type="date" value-format="YYYY-MM-DD" :validate-event="false" style="width: 100%" placeholder="选择交货日期" @change="onDeliveryDateChange" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="erp-group">
          <div class="erp-group-title" style="display: flex; align-items: center">
            <span style="flex: 1" />
            <el-button size="small" type="primary" @click="addItem"><el-icon><Plus /></el-icon>添加明细</el-button>
          </div>
          <el-form-item label-width="0">
            <el-table :data="form.items" class="items-editor" size="small" style="width: 100%">
              <el-table-column label="产品" min-width="220">
                <template #default="{ row }">
                  <el-select v-model="row.materialId" filterable remote :remote-method="searchProducts" :loading="loadingProducts" placeholder="搜索产品（编码/名称）" style="width: 100%" @change="(v: number) => onProductChange(row, v)">
                    <el-option v-for="p in products" :key="p.id" :label="`${p.code} - ${p.name}${p.specification ? ` / ${p.specification}` : ''}`" :value="p.id" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="88" align="center">
                <template #default="{ row }">
                  <el-select v-model="row.unit" filterable allow-create default-first-option placeholder="单位" size="small" style="width: 100%">
                    <el-option v-for="u in rowUnitOptions(row)" :key="u" :label="u" :value="u" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="105">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="1" :controls="false" style="width: 100%" />
                  <div v-if="rowBaseHint(row)" class="unit-hint">{{ rowBaseHint(row) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="单价" width="115">
                <template #default="{ row }">
                  <el-input-number v-model="row.unitPrice" :min="0" :precision="2" :controls="false" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="含税" width="65" align="center">
                <template #default="{ row }">
                  <el-checkbox v-model="row.taxIncluded" @change="(v: any) => { row.taxIncluded = !!v }" />
                </template>
              </el-table-column>
              <el-table-column label="税率%" width="95">
                <template #default="{ row }">
                  <el-select v-model="row.taxRate" filterable allow-create default-first-option placeholder="税率" style="width: 100%">
                    <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}`" :value="r" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="含税金额" width="105" align="right">
                <template #default="{ row }">
                  {{ taxAmountOf(row) }}
                </template>
              </el-table-column>
              <el-table-column label="交货日期" width="140">
                <template #default="{ row }">
                  <el-date-picker v-model="row.deliveryDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="明细交货日期" />
                </template>
              </el-table-column>
              <el-table-column width="60">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeItem($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-form-item>

          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
          </el-form-item>
        </div>
      </el-form>
    </div>

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
.unit-hint {
  font-size: 11px;
  line-height: 1.2;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
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