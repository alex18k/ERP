<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderApi, materialApi, customerApi, systemApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', customerName: '', status: '' })
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const customers = ref<any[]>([])
const products = ref<any[]>([])
const loadingProducts = ref(false)
const prevDeliveryDate = ref('')
const form = reactive<any>({
  id: null,
  customerId: null,
  customerCode: '',
  customerName: '',
  orderDate: '',
  channel: '',
  seller1: '',
  seller2: '',
  paymentMethod: '',
  deliveryDate: '',
  remark: '',
  items: [],
})

const paymentOptions = ['款到发货', '货到付款', '预付款', '月结30天', '银行转账', '电汇', '承兑汇票']

const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]

const userOptions = ref<string[]>([])

async function loadSellers() {
  try {
    const res: any = await systemApi.salespersons()
    const items: any[] = res.data?.items || res.data || []
    userOptions.value = [...new Set(items.map((u: any) => u.realName || u.username).filter(Boolean))]
  } catch {
    userOptions.value = []
  }
}

function validateDeliveryDate(_rule: any, value: string, callback: (e?: Error) => void) {
  if (value && form.orderDate && value < form.orderDate) {
    callback(new Error('交货日期不能早于订货日期'))
  } else {
    callback()
  }
}

const rules = {
  customerName: [{ required: true, message: '请选择客户', trigger: 'change' }],
  orderDate: [{ required: true, message: '请选择订货日期', trigger: 'change' }],
  seller1: [{ required: true, message: '请选择销售员1', trigger: 'change' }],
  deliveryDate: [
    { required: true, message: '请选择交货日期', trigger: 'change' },
    { validator: validateDeliveryDate, trigger: 'change' },
  ],
}

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

async function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) {
    Object.assign(form, row)
    form.orderDate = row.orderDate?.slice(0, 10) || ''
    form.deliveryDate = row.deliveryDate?.slice(0, 10) || ''
    form.items = (row.items?.map((i: any) => ({ ...i })) || []).map((i: any) => ({
      ...i,
      deliveryDate: i.deliveryDate ? String(i.deliveryDate).slice(0, 10) : form.deliveryDate,
    }))
  } else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.items = []
  }
  await loadOptions()
  loadSellers()
  customerFilter.value = ''
  if (isEdit.value && form.customerId) {
    const found = customers.value.find((c: any) => c.id === form.customerId)
    if (found) {
      form.customerCode = form.customerCode || found.code
    } else {
      customers.value = [
        { id: form.customerId, code: form.customerCode || '', name: form.customerName || '' },
        ...customers.value,
      ]
    }
  }
  prevDeliveryDate.value = form.deliveryDate || ''
  dialogVisible.value = true
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

async function loadOptions() {
  const cRes: any = await customerApi.list({ pageSize: 200 })
  customers.value = cRes.data.items
  await searchProducts('')
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

function filterCustomerMethod(query: string) {
  customerFilter.value = query
}

function onCustomerVisible(visible: boolean) {
  if (!visible) customerFilter.value = ''
}

function onCustomerChange(val: any) {
  const c = customers.value.find((x) => x.id === val)
  if (c) {
    form.customerName = c.name
    form.customerCode = c.code
  }
}

function addItem() {
  form.items.push({ materialId: null, quantity: 1, unitPrice: 0, unit: '', deliveryDate: form.deliveryDate || '', taxIncluded: false, taxRate: 0 })
}

function onDeliveryDateChange(val: string) {
  for (const item of form.items) {
    if (!item.deliveryDate || item.deliveryDate === prevDeliveryDate.value) item.deliveryDate = val || ''
  }
  prevDeliveryDate.value = val || ''
}

function onOrderDateChange() {
  if (form.deliveryDate) formRef.value?.validateField('deliveryDate', () => {})
}

function onProductChange(row: any, materialId: number) {
  const m = products.value.find((p) => p.id === materialId)
  if (m) {
    row.material = m
    if (m.unit) row.unit = m.unit
  }
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

function getUnitPrice(materialId: number) {
  const m = products.value.find((p) => p.id === materialId)
  return m || null
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  if (form.items.length === 0) {
    ElMessage.warning('请至少添加一个产品')
    return
  }
  for (const item of form.items) {
    if (!item.materialId) {
      ElMessage.warning('请选择产品物料')
      return
    }
    if (!item.deliveryDate) {
      ElMessage.warning('请填写明细交货日期')
      return
    }
    if (!item.unitPrice) {
      const mat = getUnitPrice(item.materialId)
      if (mat) item.unitPrice = 0
    }
  }
  const payload = {
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

  if (isEdit.value) {
    await orderApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await orderApi.create(payload)
    ElMessage.success('创建成功，订单已确认')
  }
  dialogVisible.value = false
  loadData()
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
        <el-button type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增订单</el-button>
        <el-button @click="orderApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="flatRows" v-loading="loading" stripe max-height="calc(100vh - 260px)">
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
            <span :class="{ 'text-overdue': (row._lineDeliveryDate || row.deliveryDate) && new Date(row._lineDeliveryDate || row.deliveryDate) < new Date() && !['completed','shipped'].includes(row.status) }">
              {{ (row._lineDeliveryDate || row.deliveryDate || '-').toString().slice(0, 10) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row._first" :type="statusType(row.status)">{{ formatStatus(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="router.push(`/order/print?id=${row.id}`)">打印</el-button>
            <el-button size="small" type="primary" link @click="router.push(`/order/tracking?id=${row.id}`)">跟踪</el-button>
            <el-button v-if="['draft','confirmed','in_production'].includes(row.status)" size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button v-if="row.status === 'completed'" size="small" type="primary" link @click="handleShip(row)">发货</el-button>
            <el-button v-if="['draft','confirmed','in_production'].includes(row.status)" size="small" type="danger" link @click="openCancelDialog(row)">取消</el-button>
          </template>
        </el-table-column>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑订单' : '新增销售订单'" width="1080px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <div class="erp-group">
          <div class="erp-group-title">基本信息</div>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="客户" prop="customerName">
              <el-select
                v-model="form.customerId"
                filterable
                :filter-method="filterCustomerMethod"
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
              <el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择订货日期" @change="onOrderDateChange" />
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
              <el-select v-model="form.seller1" filterable placeholder="选择销售员" style="width: 100%">
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
              <el-date-picker v-model="form.deliveryDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择交货日期" @change="onDeliveryDateChange" />
            </el-form-item>
          </el-col>
        </el-row>
        </div>

        <div class="erp-group">
        <div class="erp-group-title" style="display: flex; align-items: center">
          <span>产品明细</span>
          <span style="flex: 1" />
          <el-button size="small" type="primary" @click="addItem"><el-icon><Plus /></el-icon>添加明细</el-button>
        </div>
        <el-form-item label-width="0">
          <div style="width: 100%">
            <el-table :data="form.items" class="items-editor" size="small" style="width: 100%">
              <el-table-column label="产品" min-width="220">
                <template #default="{ row }">
                  <el-select v-model="row.materialId" filterable remote :remote-method="searchProducts" :loading="loadingProducts" placeholder="搜索产品（编码/名称）" style="width: 100%" @change="(v: number) => onProductChange(row, v)">
                    <el-option v-for="p in products" :key="p.id" :label="`${p.code} - ${p.name}${p.specification ? ` / ${p.specification}` : ''}`" :value="p.id" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="58" align="center">
                <template #default="{ row }">
                  <el-input v-model="row.unit" placeholder="单位" @change="(v: string) => { row.unit = v }" />
                </template>
              </el-table-column>
              <el-table-column label="数量" width="105">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="1" :controls="false" style="width: 100%" />
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
          </div>
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
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