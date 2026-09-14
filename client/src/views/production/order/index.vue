<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, mrpApi, materialApi, orderApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', status: '', materialName: '' })

const statusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已完成', value: 'completed', type: 'success' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

const createDialogVisible = ref(false)
const mrpRun = ref<any>(null)
const suggestions = ref<any[]>([])
const selectedProd = ref<number[]>([])
const creating = ref(false)

const editDialogVisible = ref(false)
const saving = ref(false)
const editFormRef = ref()
const editForm = reactive<any>({
  id: null, orderNo: '', materialName: '', salesOrderNo: '', quantity: 0, planStartDate: '', planEndDate: '', planner: '', releaseDate: '', remark: '',
})
const editRules = {
  quantity: [{ required: true, message: '请输入生产数量', trigger: 'blur' }],
  planStartDate: [{ required: true, message: '请选择计划开始日期', trigger: 'change' }],
  planEndDate: [{ required: true, message: '请选择计划结束日期', trigger: 'change' }],
  planner: [{ required: true, message: '请选择计划员', trigger: 'change' }],
  releaseDate: [{ required: true, message: '请选择下达日期', trigger: 'change' }],
}

// ===== 手工新增生产订单 =====
const manualDialogVisible = ref(false)
const manualSaving = ref(false)
const manualFormRef = ref()
const manualMaterials = ref<any[]>([])
const manualMaterialMap = new Map<number, any>()
const manualMaterialLoading = ref(false)
const salesOrders = ref<any[]>([])
const salesOrderLoading = ref(false)
const manualForm = reactive<any>({
  materialId: null, quantity: 1, salesOrderNo: '', planStartDate: '', planEndDate: '', planner: '', releaseDate: '', remark: '',
})
const manualRules = {
  materialId: [{ required: true, message: '请选择产品', trigger: 'change' }],
  quantity: [{ required: true, message: '请输入生产数量', trigger: 'blur' }],
  planStartDate: [{ required: true, message: '请选择计划开始日期', trigger: 'change' }],
  planEndDate: [{ required: true, message: '请选择计划结束日期', trigger: 'change' }],
  planner: [{ required: true, message: '请选择计划员', trigger: 'change' }],
  releaseDate: [{ required: true, message: '请选择下达日期', trigger: 'change' }],
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function registerManualMaterials(items: any[]) {
  for (const m of items) if (m?.id) manualMaterialMap.set(m.id, m)
  manualMaterials.value = [...manualMaterialMap.values()]
}

async function searchManualMaterials(keyword: string) {
  manualMaterialLoading.value = true
  try {
    const res: any = await materialApi.options({ category: 'manufacture', keyword, limit: 50 })
    registerManualMaterials(res.data || [])
  } catch {
    /* ignore */
  } finally {
    manualMaterialLoading.value = false
  }
}

async function loadSalesOrders() {
  salesOrderLoading.value = true
  try {
    const res: any = await orderApi.list({ page: 1, pageSize: 200, status: 'confirmed' })
    salesOrders.value = res.data?.items || []
  } catch {
    /* ignore */
  } finally {
    salesOrderLoading.value = false
  }
}

async function openManualDialog() {
  Object.assign(manualForm, { materialId: null, quantity: 1, salesOrderNo: '', planStartDate: '', planEndDate: '', planner: '', releaseDate: todayStr(), remark: '' })
  manualMaterialMap.clear()
  manualMaterials.value = []
  loadSalesOrders()
  await searchManualMaterials('')
  manualDialogVisible.value = true
}

async function submitManualOrder() {
  try { await manualFormRef.value.validate() } catch { return }
  if (!manualForm.quantity || manualForm.quantity <= 0) {
    ElMessage.warning('生产数量必须大于0')
    return
  }
  manualSaving.value = true
  try {
    const res: any = await productionApi.createOrders([{
      materialId: manualForm.materialId,
      quantity: manualForm.quantity,
      salesOrderNo: manualForm.salesOrderNo || undefined,
      planStartDate: manualForm.planStartDate,
      planEndDate: manualForm.planEndDate,
      planner: manualForm.planner,
      releaseDate: manualForm.releaseDate,
      remark: manualForm.remark,
    }])
    const createdCount = res.data?.created?.length ?? 0
    const skippedCount = res.data?.skipped?.length ?? 0
    ElMessage.success(skippedCount > 0 ? `已创建 ${createdCount} 张，跳过 ${skippedCount} 张（已下达过）` : `已创建 ${createdCount} 张生产订单`)
    manualDialogVisible.value = false
    loadData()
  } catch { /* error shown */ } finally {
    manualSaving.value = false
  }
}

const scheduleDialogVisible = ref(false)
const scheduling = ref(false)
const scheduleOrder = ref<any>(null)
const scheduleBatches = ref<any[]>([])
const schedulePlanner = ref('')
const scheduledQty = computed(() =>
  (scheduleOrder.value?.batches || [])
    .filter((b: any) => b.status !== 'cancelled')
    .reduce((s: number, b: any) => s + b.quantity, 0)
)
const remainingQty = computed(() => Math.max(0, (scheduleOrder.value?.quantity || 0) - scheduledQty.value))
const batchTotal = computed(() => scheduleBatches.value.reduce((s: number, b: any) => s + (Number(b.quantity) || 0), 0))

function orderScheduledQty(row: any) {
  return (row.batches || [])
    .filter((b: any) => b.status !== 'cancelled')
    .reduce((s: number, b: any) => s + b.quantity, 0)
}

function canSchedule(row: any) {
  return row.status !== 'completed' && orderScheduledQty(row) < row.quantity - 1e-6
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.orders(query)
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

async function openCreateDialog() {
  const res: any = await mrpApi.shortage()
  const latest = res.data.latestRun
  if (!latest) {
    ElMessage.warning('请先执行MRP运算')
    return
  }
  const [detail, keysRes]: any[] = await Promise.all([mrpApi.getRun(latest.id), productionApi.issuedKeys()])
  mrpRun.value = detail.data
  const issued = new Set((keysRes.data || []).map((k: any) => `${k.materialId}-${k.salesOrderId}`))
  suggestions.value = (detail.data.result?.productionOrders || [])
    .filter((s: any) => !issued.has(`${s.materialId}-${s.relatedOrderId}`))
    .map((s: any) => ({ ...s, issued: false, planEndDate: s.needDate?.slice?.(0, 10) || '' }))
  selectedProd.value = []
  createDialogVisible.value = true
}

async function handleCreateOrders() {
  if (selectedProd.value.length === 0) {
    ElMessage.warning('请选择要下达的生产建议')
    return
  }
  creating.value = true
  try {
    const missing = suggestions.value
      .filter((_, i) => selectedProd.value.includes(i))
      .filter((s) => !s.planEndDate)
    if (missing.length > 0) {
      ElMessage.warning('请为选中的生产建议填写计划交期')
      creating.value = false
      return
    }
    const payload = suggestions.value
      .filter((_, i) => selectedProd.value.includes(i))
      .map((s) => ({
        materialId: s.materialId,
        quantity: s.quantity,
        salesOrderId: s.relatedOrderId,
        planStartDate: new Date().toISOString().slice(0, 10),
        planEndDate: s.planEndDate,
        remark: `来自MRP建议-${s.orderNo || ''}`,
      }))
    const res: any = await productionApi.createOrders(payload)
    const createdCount = res.data?.created?.length ?? 0
    const skippedCount = res.data?.skipped?.length ?? 0
    ElMessage.success(skippedCount > 0 ? `已创建 ${createdCount} 张，跳过 ${skippedCount} 张（已下达过）` : `已创建 ${createdCount} 张生产订单`)
    createDialogVisible.value = false
    loadData()
  } catch { /* error shown */ } finally {
    creating.value = false
  }
}

function openEditDialog(row: any) {
  Object.assign(editForm, {
    id: row.id,
    orderNo: row.orderNo,
    materialName: `${row.material?.code || ''} - ${row.material?.name || ''}`,
    salesOrderNo: row.salesOrder?.orderNo || '-',
    quantity: row.quantity,
    planStartDate: row.planStartDate?.slice(0, 10) || '',
    planEndDate: row.planEndDate?.slice(0, 10) || '',
    planner: row.planner || '',
    releaseDate: row.releaseDate?.slice(0, 10) || '',
    remark: row.remark || '',
  })
  editDialogVisible.value = true
}

async function handleUpdate() {
  try { await editFormRef.value.validate() } catch { return }
  if (!editForm.quantity || editForm.quantity <= 0) {
    ElMessage.warning('生产数量必须大于0')
    return
  }
  saving.value = true
  try {
    await productionApi.updateOrder(editForm.id, {
      quantity: editForm.quantity,
      planStartDate: editForm.planStartDate || '',
      planEndDate: editForm.planEndDate || '',
      planner: editForm.planner,
      releaseDate: editForm.releaseDate || '',
      remark: editForm.remark,
    })
    ElMessage.success('更新成功')
    editDialogVisible.value = false
    loadData()
  } catch { /* error shown */ } finally {
    saving.value = false
  }
}

async function handleSchedule(row: any) {
  scheduleOrder.value = row
  const scheduled = (row.batches || [])
    .filter((b: any) => b.status !== 'cancelled')
    .reduce((s: number, b: any) => s + b.quantity, 0)
  const remain = Math.max(0, (row.quantity || 0) - scheduled)
  scheduleBatches.value = [
    { quantity: remain, planStartDate: row.planStartDate?.slice(0, 10) || '', planEndDate: row.planEndDate?.slice(0, 10) || '' },
  ]
  schedulePlanner.value = row.planner || ''
  scheduleDialogVisible.value = true
}

function addBatch() {
  scheduleBatches.value.push({ quantity: 0, planStartDate: '', planEndDate: '' })
}

function removeBatch(index: number) {
  scheduleBatches.value.splice(index, 1)
}

async function submitSchedule() {
  const batches = scheduleBatches.value
  if (batches.length === 0) {
    ElMessage.warning('请至少添加一个批次')
    return
  }
  for (const b of batches) {
    if (!b.quantity || b.quantity <= 0) {
      ElMessage.warning('批次数量必须大于0')
      return
    }
  }
  if (batchTotal.value > remainingQty.value + 1e-6) {
    ElMessage.warning(`本次批次合计 ${batchTotal.value} 超过剩余可排产量 ${remainingQty.value}`)
    return
  }
  if (!schedulePlanner.value) {
    ElMessage.warning('请选择计划员')
    return
  }
  scheduling.value = true
  try {
    const res: any = await productionApi.schedule(scheduleOrder.value.id, { batches, planner: schedulePlanner.value })
    ElMessage.success(`排产完成，生成 ${res.data?.workOrders?.length ?? 0} 张加工单`)
    scheduleDialogVisible.value = false
    loadData()
  } catch { /* error shown */ } finally {
    scheduling.value = false
  }
}

async function handleCancel(row: any) {
  try {
    await ElMessageBox.confirm(`确定取消生产订单 ${row.orderNo} ？`, '提示', { type: 'warning' })
    await productionApi.cancelOrder(row.id)
    ElMessage.success('已取消')
    loadData()
  } catch { /* canceled */ }
}

const plannerOptions = ref<any[]>([])
async function loadPlanners() {
  try {
    const res: any = await productionApi.planners()
    plannerOptions.value = res.data || []
  } catch { /* ignore */ }
}

onMounted(() => {
  loadData()
  loadPlanners()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 160px" />
        <el-input v-model="query.materialName" placeholder="物料名称" clearable style="width: 160px" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', materialName: '', status: '', page: 1 }), loadData()">重置</el-button>
        <div style="flex: 1" />
        <el-button type="success" plain class="btn-add" @click="openManualDialog">
          <el-icon><Plus /></el-icon>新增生产订单
        </el-button>
        <el-button type="primary" plain @click="openCreateDialog">
          <el-icon><Plus /></el-icon>从MRP建议下达
        </el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="生产订单号" width="140" />
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">{{ row.material?.code }} - {{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="90" />
        <el-table-column label="来源订单" min-width="130">
          <template #default="{ row }">
            <span v-if="row.salesOrder">{{ row.salesOrder.orderNo }}<br /><small>{{ row.salesOrder.customerName }}</small></span>
            <span v-else-if="row.salesOrderNo">{{ row.salesOrderNo }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="计划周期" min-width="190">
          <template #default="{ row }">
            <span v-if="row.planStartDate">{{ row.planStartDate?.slice(0, 10) }} ~ {{ row.planEndDate?.slice(0, 10) }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="计划员" width="90">
          <template #default="{ row }">{{ row.planner || '-' }}</template>
        </el-table-column>
        <el-table-column label="下达日期" width="110">
          <template #default="{ row }">{{ row.releaseDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="加工单" width="80">
          <template #default="{ row }">{{ row.workOrders?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="批次/已排" width="120">
          <template #default="{ row }">
            <span v-if="(row.batches || []).length">{{ row.batches.length }} 批 / {{ orderScheduledQty(row) }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="canSchedule(row)" size="small" type="success" link @click="handleSchedule(row)">排产</el-button>
            <el-button v-if="['planned', 'in_progress'].includes(row.status)" size="small" type="danger" link @click="handleCancel(row)">取消</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="manualDialogVisible" title="新增生产订单" width="560px" destroy-on-close>
      <el-form ref="manualFormRef" :model="manualForm" :rules="manualRules" label-width="110px">
        <el-form-item label="产品" prop="materialId">
          <el-select v-model="manualForm.materialId" filterable remote reserve-keyword :remote-method="searchManualMaterials" :loading="manualMaterialLoading" placeholder="输入编码/名称搜索制造类物料" style="width: 100%">
            <el-option v-for="m in manualMaterials" :key="m.id" :label="`${m.code} - ${m.name}${m.specification ? ' / ' + m.specification : ''}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="生产数量" prop="quantity">
          <el-input-number v-model="manualForm.quantity" :min="0.01" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="销售订单号">
          <el-select v-model="manualForm.salesOrderNo" filterable allow-create default-first-option clearable :loading="salesOrderLoading" placeholder="下拉选择已确认订单，或直接输入订单号" style="width: 100%">
            <el-option v-for="o in salesOrders" :key="o.orderNo" :label="`${o.orderNo}（${o.customerName || '-'}）`" :value="o.orderNo" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划开始" prop="planStartDate">
          <el-date-picker v-model="manualForm.planStartDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束" prop="planEndDate">
          <el-date-picker v-model="manualForm.planEndDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划员" prop="planner">
          <el-select v-model="manualForm.planner" filterable clearable placeholder="选择计划员" style="width: 100%">
            <el-option v-for="p in plannerOptions" :key="p.id" :label="p.realName || p.username" :value="p.realName || p.username" />
          </el-select>
        </el-form-item>
        <el-form-item label="下达日期" prop="releaseDate">
          <el-date-picker v-model="manualForm.releaseDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="manualForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="manualSaving" @click="submitManualOrder">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createDialogVisible" title="从MRP建议下达生产订单" width="760px" top="6vh">
      <el-alert v-if="mrpRun" type="info" :closable="false" :title="`基于最近一次MRP运算 (#${mrpRun.runNo}) 的半成品/成品生产建议`" style="margin-bottom: 12px" />
      <el-table :data="suggestions" size="small" max-height="360" @selection-change="(v: any) => (selectedProd = v.map((r: any) => suggestions.indexOf(r)))">
        <el-table-column type="selection" width="45" />
        <el-table-column label="物料" min-width="150">
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="建议量" width="90" />
        <el-table-column label="关联订单" min-width="130">
          <template #default="{ row }">
            <span v-if="row.orderNo">{{ row.orderNo }}<br /><small>{{ row.customerName || '-' }}</small></span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="计划交期" width="150">
          <template #default="{ row }">
            <el-date-picker v-model="row.planEndDate" type="date" value-format="YYYY-MM-DD" placeholder="必填，选择交期" style="width: 100%" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreateOrders">确认下达</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑生产订单" width="520px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="生产订单号">
          <span>{{ editForm.orderNo }}</span>
        </el-form-item>
        <el-form-item label="物料">
          <span>{{ editForm.materialName }}</span>
        </el-form-item>
        <el-form-item label="来源订单">
          <span>{{ editForm.salesOrderNo }}</span>
        </el-form-item>
        <el-form-item label="生产数量">
          <el-input-number v-model="editForm.quantity" :min="0.01" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划开始">
          <el-date-picker v-model="editForm.planStartDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划结束">
          <el-date-picker v-model="editForm.planEndDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计划员">
          <el-select v-model="editForm.planner" filterable clearable placeholder="选择计划员" style="width: 100%">
            <el-option v-for="p in plannerOptions" :key="p.id" :label="p.realName || p.username" :value="p.realName || p.username" />
          </el-select>
        </el-form-item>
        <el-form-item label="下达日期">
          <el-date-picker v-model="editForm.releaseDate" type="date" value-format="YYYY-MM-DD" placeholder="选择下达日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleUpdate">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scheduleDialogVisible" title="排产（分批）" width="720px">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ scheduleOrder?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="数量">{{ scheduleOrder?.quantity }}</el-descriptions-item>
        <el-descriptions-item label="已排 / 剩余">{{ scheduledQty }} / {{ remainingQty }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="70px" inline style="margin-bottom: 4px">
        <el-form-item label="计划员">
          <el-select v-model="schedulePlanner" filterable clearable placeholder="选择计划员" style="width: 220px">
            <el-option v-for="p in plannerOptions" :key="p.id" :label="p.realName || p.username" :value="p.realName || p.username" />
          </el-select>
        </el-form-item>
      </el-form>
      <div style="margin-bottom: 8px">
        <el-button size="small" type="primary" plain @click="addBatch"><el-icon><Plus /></el-icon>添加批次</el-button>
        <span style="margin-left: 12px; color: var(--el-text-color-secondary)">本次合计：{{ batchTotal }} / 剩余 {{ remainingQty }}</span>
      </div>
      <el-table :data="scheduleBatches" size="small" stripe>
        <el-table-column label="批次" width="70">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column label="数量" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="0" :precision="2" :controls="false" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="计划开始" min-width="160">
          <template #default="{ row }">
            <el-date-picker v-model="row.planStartDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="计划结束" min-width="160">
          <template #default="{ row }">
            <el-date-picker v-model="row.planEndDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column width="60">
          <template #default="{ $index }">
            <el-button type="danger" link size="small" @click="removeBatch($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="scheduleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="scheduling" @click="submitSchedule">确认排产</el-button>
      </template>
    </el-dialog>
  </div>
</template>