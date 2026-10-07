<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
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

function orderScheduledQty(row: any) {
  return (row.batches || [])
    .filter((b: any) => b.status !== 'cancelled')
    .reduce((s: number, b: any) => s + b.quantity, 0)
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
    .map((s: any) => ({ ...s, issued: false, planStartDate: s.orderDate?.slice?.(0, 10) || '', planEndDate: s.needDate?.slice?.(0, 10) || '' }))
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
        planStartDate: s.planStartDate || new Date().toISOString().slice(0, 10),
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

onMounted(() => {
  loadData()
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
        <el-table-column label="批次" width="80">
          <template #default="{ row }">{{ row.batches?.length || 0 }}</template>
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
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

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
  </div>
</template>
