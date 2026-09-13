<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, supplierApi, materialApi, systemApi } from '../../../api'
import { BASE_LOCATIONS } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const router = useRouter()
const query = reactive({ page: 1, pageSize: 20, orderNo: '', supplierId: '', status: '' })

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
  { label: '部分收货', value: 'partial_received', type: 'warning' },
  { label: '已收货', value: 'received', type: 'success' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]
const editableStatusOptions = statusOptions.filter((o) => ['draft', 'confirmed', 'cancelled'].includes(o.value))

const dialogVisible = ref(false)
const formRef = ref()
const suppliers = ref<any[]>([])
const materials = ref<any[]>([])
const materialLoading = ref(false)
const buyerOptions = ref<string[]>([])
const unitOptions = ref<string[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]
const headerLocation = ref('')
const form = reactive<any>({ id: null, supplierId: null, settleMethod: '', orderDate: '', expectedDate: '', buyer: '', taxIncluded: false, taxRate: 0, remark: '', items: [] })

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const settleMethodOptions = ['现金', '月结', '月结30天', '月结60天', '货到付款', '预付款', '其他']

const rules = {
  supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }],
  orderDate: [{ required: true, message: '请选择订货日期', trigger: 'change' }],
  expectedDate: [{ required: true, message: '请选择截止日期', trigger: 'change' }],
  buyer: [{ required: true, message: '请输入采购员', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function statusLabel(s: string) {
  return statusOptions.find(o => o.value === s)?.label || s
}
function statusType(s: string) {
  return statusOptions.find(o => o.value === s)?.type || 'info'
}

// 平铺明细行：每行 = 一个采购明细
const rows = computed(() => {
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        settleMethod: o.settleMethod,
        buyer: o.buyer,
        status: o.status,
        orderDate: o.orderDate,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        unitPrice: it.unitPrice,
        amount: it.amount,
        expectedDate: it.expectedDate,
      })
    }
  }
  return out
})

function editOrder(orderId: number) {
  const order = list.value.find((o) => o.id === orderId)
  if (order) openDialog(order)
}

function cancelOrder(orderId: number) {
  const order = list.value.find((o) => o.id === orderId)
  if (order) handleCancel(order)
}

function onSupplierChange() {
  const s = suppliers.value.find((s) => s.id === form.supplierId)
  if (s?.settleMethod) form.settleMethod = s.settleMethod
  else if (!form.settleMethod) form.settleMethod = ''
  if (s?.buyer && !form.buyer) form.buyer = s.buyer
  if (s) {
    form.taxIncluded = !!s.taxIncluded
    form.taxRate = s.taxRate ?? 0
    for (const it of form.items) {
      it.taxIncluded = form.taxIncluded
      it.taxRate = form.taxRate
    }
  }
}

async function loadBuyers() {
  try {
    const res: any = await systemApi.users({ pageSize: 100, status: 1 })
    const items: any[] = res.data.items || res.data || []
    buyerOptions.value = [...new Set(items.map((u: any) => u.realName || u.username).filter(Boolean))]
  } catch {
    buyerOptions.value = []
  }
}

async function openDialog(row?: any) {
  const [sRes, mRes] = await Promise.all([
    supplierApi.list({ pageSize: 200 }),
    materialApi.options({ category: 'purchase', limit: 200 }),
  ])
  suppliers.value = sRes.data.items
  materialMap.clear()
  registerMaterials(mRes.data || [])

  isEditLoad.value = !!row
  if (row) {
    Object.assign(form, row)
    form.orderDate = row.orderDate?.slice(0, 10) || ''
    form.expectedDate = row.expectedDate?.slice(0, 10) || ''
    form.buyer = row.buyer || ''
    form.items = row.items?.map((i: any) => ({
      materialId: i.materialId,
      quantity: i.quantity,
      unit: i.unit || i.material?.unit || '',
      unitPrice: i.unitPrice,
      taxIncluded: !!i.taxIncluded,
      taxRate: i.taxRate ?? 0,
      location: i.location || i.material?.location || '',
      expectedDate: i.expectedDate?.slice(0, 10) || '',
      remark: i.remark || '',
    })) || []
    // 保证明细已选物料在下拉选项中（否则只显示物料ID）
    registerMaterials((row.items || []).map((i: any) => i.material).filter(Boolean))
    const locs = new Set<string>((row.items || []).map((i: any) => i.location).filter(Boolean))
    headerLocation.value = locs.size === 1 ? [...locs][0] : ''
  } else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.orderDate = todayStr()
    form.expectedDate = ''
    form.buyer = ''
    form.taxIncluded = false
    form.taxRate = 0
    form.items = []
    headerLocation.value = ''
  }
  buildItemOptions()
  loadBuyers()
  dialogVisible.value = true
}

const materialMap = new Map<number, any>()
function registerMaterials(items: any[]) {
  for (const m of items) if (m?.id) materialMap.set(m.id, m)
  materials.value = [...materialMap.values()]
}

async function searchMaterials(keyword: string) {
  materialLoading.value = true
  try {
    const res: any = await materialApi.options({ category: 'purchase', keyword, limit: 50 })
    registerMaterials(res.data || [])
    buildItemOptions()
  } catch {
    /* ignore */
  } finally {
    materialLoading.value = false
  }
}

function applyLocationToItems() {
  for (const it of form.items) it.location = headerLocation.value || ''
}

function addItem() {
  form.items.push({ materialId: null, quantity: 1, unit: '', unitPrice: 0, taxIncluded: !!form.taxIncluded, taxRate: form.taxRate ?? 0, location: headerLocation.value || '', expectedDate: '', remark: '' })
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

function onMaterialChange(row: any, materialId: number) {
  const m = materials.value.find((x) => x.id === materialId)
  if (!m) return
  if (m.unit) row.unit = m.unit
  row.location = m.location || headerLocation.value || ''
}
function removeItem(index: number) {
  form.items.splice(index, 1)
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  if (form.items.length === 0) {
    ElMessage.warning('请至少添加一个采购明细')
    return
  }
  for (const it of form.items) {
    if (!it.materialId) { ElMessage.warning('请选择物料'); return }
  }
  const payload = {
    supplierId: form.supplierId,
    settleMethod: form.settleMethod || undefined,
    orderDate: form.orderDate || undefined,
    expectedDate: form.expectedDate || undefined,
    buyer: form.buyer || undefined,
    taxIncluded: !!form.taxIncluded,
    taxRate: form.taxRate ?? 0,
    remark: form.remark,
    items: form.items,
  }
  try {
    if (isEditLoad.value) {
      await purchaseApi.update(form.id, payload)
      ElMessage.success('采购单更新成功')
    } else {
      await purchaseApi.create(payload)
      ElMessage.success('采购单创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch { /* error shown */ }
}

async function handleCancel(row: any) {
  try {
    await ElMessageBox.confirm(`确定取消采购单 ${row.orderNo} ？`, '提示', { type: 'warning' })
    await purchaseApi.cancel(row.id)
    ElMessage.success('采购单已取消')
    loadData()
  } catch { /* canceled */ }
}

async function handleConfirm(row: any) {
  try {
    await ElMessageBox.confirm(`确认采购单 ${row.orderNo} ？确认后方可收货。`, '提示', { type: 'warning' })
    await purchaseApi.confirm(row.orderId)
    ElMessage.success('采购单已确认')
    loadData()
  } catch { /* canceled */ }
}

async function handleStatusChange(row: any, status: string) {
  if (status === row.status) return
  try {
    await ElMessageBox.confirm(`将采购单 ${row.orderNo} 状态改为「${statusLabel(status)}」？`, '提示', { type: 'warning' })
  } catch {
    loadData()
    return
  }
  try {
    await purchaseApi.updateStatus(row.orderId, status)
    ElMessage.success('状态已更新')
  } catch {
    /* error shown */
  } finally {
    loadData()
  }
}

const isEditLoad = ref(false)
onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 150px" />
        <el-select v-model="query.supplierId" placeholder="供应商" clearable filterable style="width: 180px">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', supplierId: '', status: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <el-button type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>新增采购单</el-button>
        <el-button @click="purchaseApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="orderNo" label="采购单号" width="150" />
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column prop="buyer" label="采购员" width="100" />
        <el-table-column label="订货日期" width="110">
          <template #default="{ row }">{{ row.orderDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="settleMethod" label="结算方式" width="100" />
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <span>{{ row.materialCode }} - {{ row.materialName }}</span>
            <span v-if="row.specification" style="color: var(--el-text-color-secondary); margin-left: 6px">{{ row.specification }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="90" />
        <el-table-column prop="receivedQty" label="已收" width="80" />
        <el-table-column prop="unitPrice" label="单价" width="80" />
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ (row.amount ?? (row.quantity * (row.unitPrice || 0))).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110">
          <template #default="{ row }">{{ row.expectedDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-select
              v-if="['draft', 'confirmed', 'cancelled'].includes(row.status)"
              :model-value="row.status"
              size="small"
              style="width: 100%"
              @change="(v: string) => handleStatusChange(row, v)"
            >
              <el-option v-for="o in editableStatusOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-tag v-else :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button v-if="['draft', 'confirmed'].includes(row.status)" size="small" type="primary" link @click="editOrder(row.orderId)">编辑</el-button>
            <el-button v-if="row.status === 'draft'" size="small" type="success" link @click="handleConfirm(row)">确认</el-button>
            <el-button size="small" type="primary" link @click="router.push(`/purchase/print?id=${row.orderId}`)">打印</el-button>
            <el-button v-if="['draft', 'confirmed', 'partial_received'].includes(row.status)" size="small" type="danger" link @click="cancelOrder(row.orderId)">取消</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEditLoad ? '编辑采购单' : '新增采购单'" width="1200px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="14">
            <el-form-item label="供应商" prop="supplierId">
              <el-select v-model="form.supplierId" filterable style="width: 100%" @change="onSupplierChange">
                <el-option v-for="s in suppliers" :key="s.id" :label="s.name + (s.settleMethod ? `（${s.settleMethod}）` : '')" :value="s.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item label="结算方式">
              <el-select v-model="form.settleMethod" filterable allow-create default-first-option placeholder="自动带出，可改" style="width: 100%">
                <el-option v-for="m in settleMethodOptions" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="订货日期" prop="orderDate">
              <el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择订货日期" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="截止日期" prop="expectedDate">
              <el-date-picker v-model="form.expectedDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择截止日期" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="采购员" prop="buyer">
              <el-select v-model="form.buyer" filterable allow-create default-first-option placeholder="选择或输入采购员" style="width: 100%">
                <el-option v-for="b in buyerOptions" :key="b" :label="b" :value="b" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="含税">
              <el-checkbox v-model="form.taxIncluded">含税价</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="税率">
              <el-select v-model="form.taxRate" filterable allow-create default-first-option placeholder="选择或输入税率" style="width: 100%">
                <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}%`" :value="r" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="库位">
              <el-select v-model="headerLocation" clearable filterable allow-create default-first-option placeholder="选择后应用到明细" :fit-input-width="false" style="width: 100%" @change="applyLocationToItems">
                <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="采购明细">
          <div style="width: 100%">
            <el-button size="small" type="primary" plain @click="addItem"><el-icon><Plus /></el-icon>添加明细</el-button>
            <el-table :data="form.items" size="small" style="margin-top: 8px; width: 100%">
              <el-table-column label="物料" min-width="200">
                <template #default="{ row }">
                  <el-select v-model="row.materialId" filterable remote reserve-keyword :remote-method="searchMaterials" :loading="materialLoading" placeholder="输入编码/名称搜索物料" style="width: 100%" @change="(v: number) => onMaterialChange(row, v)">
                    <el-option v-for="m in materials" :key="m.id" :label="`${m.code} - ${m.name}${m.specification ? ' / ' + m.specification : ''}`" :value="m.id" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="单位" width="90">
                <template #default="{ row }">
                  <el-select v-model="row.unit" filterable allow-create default-first-option placeholder="单位" style="width: 100%">
                    <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="数量" width="85">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="1" :controls="false" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="单价" width="90">
                <template #default="{ row }">
                  <el-input-number v-model="row.unitPrice" :min="0" :precision="2" :controls="false" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="金额" width="85" align="right">
                <template #default="{ row }">
                  ¥{{ ((row.quantity || 0) * (row.unitPrice || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
                </template>
              </el-table-column>
              <el-table-column label="含税" width="60" align="center">
                <template #default="{ row }">
                  <el-checkbox v-model="row.taxIncluded" />
                </template>
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
              <el-table-column label="备注" width="140">
                <template #default="{ row }">
                  <el-input v-model="row.remark" size="small" placeholder="备注" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="70" fixed="right">
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
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>