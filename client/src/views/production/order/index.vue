<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, mrpApi } from '../../../api'

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
  suggestions.value = (detail.data.result?.productionOrders || []).map((s: any) => ({
    ...s,
    issued: issued.has(`${s.materialId}-${s.relatedOrderId}`),
  }))
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
    const payload = suggestions.value
      .filter((_, i) => selectedProd.value.includes(i))
      .map((s) => ({
        materialId: s.materialId,
        quantity: s.quantity,
        salesOrderId: s.relatedOrderId,
        planStartDate: new Date().toISOString().slice(0, 10),
        planEndDate: s.needDate?.slice?.(0, 10) || undefined,
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
  try {
    await ElMessageBox.confirm(`对生产订单 ${row.orderNo} 执行排产？（将按工艺路线生成加工单并分配工位）`, '排产', { type: 'warning' })
  } catch { return }
  const res: any = await productionApi.schedule(row.id)
  ElMessage.success(`排产完成，生成 ${res.data?.workOrders?.length ?? 0} 张加工单`)
  loadData()
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
      </div>

      <div class="table-toolbar">
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>从MRP建议下达
        </el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="orderNo" label="生产订单号" width="140" />
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">{{ row.material?.code }} - {{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="90" />
        <el-table-column label="来源订单" min-width="130">
          <template #default="{ row }">
            <span v-if="row.salesOrder">{{ row.salesOrder.orderNo }}<br /><small>{{ row.salesOrder.customerName }}</small></span>
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
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openEditDialog(row)">编辑</el-button>
            <el-button v-if="['planned', 'cancelled'].includes(row.status)" size="small" type="success" link @click="handleSchedule(row)">排产</el-button>
            <el-button v-if="['planned', 'in_progress'].includes(row.status)" size="small" type="danger" link @click="handleCancel(row)">取消</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="createDialogVisible" title="从MRP建议下达生产订单" width="760px" top="6vh">
      <el-alert v-if="mrpRun" type="info" :closable="false" :title="`基于最近一次MRP运算 (#${mrpRun.runNo}) 的半成品/成品生产建议`" style="margin-bottom: 12px" />
      <el-table :data="suggestions" size="small" max-height="360" @selection-change="(v: any) => (selectedProd = v.map((r: any) => suggestions.indexOf(r)))">
        <el-table-column type="selection" width="45" :selectable="(row: any) => !row.issued" />
        <el-table-column label="物料" min-width="150">
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="建议量" width="90" />
        <el-table-column label="关联订单" min-width="130">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="建议交期" width="120">
          <template #default="{ row }">{{ (row as any).needDate?.slice?.(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.issued ? 'info' : 'success'" size="small">{{ row.issued ? '已下达' : '待下达' }}</el-tag>
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
  </div>
</template>