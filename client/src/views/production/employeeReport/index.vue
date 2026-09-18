<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi } from '../../../api'

const route = useRoute()

// ===== 顶部录入区 =====
const submitting = ref(false)

const orderOptions = ref<any[]>([])
const orderOptionsLoading = ref(false)
const orderOptionMap = new Map<number, any>()
const selectedOrder = ref<any>(null)
const batchOptions = ref<any[]>([])
const routeSteps = ref<any[]>([])
const form = reactive<any>({
  orderNo: '',
  batchId: null,
  processStepId: null,
  reportBy: null,
  quantity: 0,
  scrapQty: 0,
  workHours: 0,
  reportTime: nowDateTime(),
  remark: '',
})

function nowDateTime() {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function registerOrderOptions(items: any[]) {
  for (const o of items) if (o?.id) orderOptionMap.set(o.id, o)
  orderOptions.value = [...orderOptionMap.values()]
}

async function loadOrderOptions(keyword: string = '') {
  orderOptionsLoading.value = true
  try {
    const res: any = await productionApi.orders({ pageSize: 100, orderNo: keyword, status: 'planned,in_progress' })
    registerOrderOptions(res.data.items || [])
  } catch {
    /* ignore */
  } finally {
    orderOptionsLoading.value = false
  }
}

async function onOrderChange() {
  routeSteps.value = []
  batchOptions.value = []
  form.batchId = null
  form.processStepId = null
  if (!form.orderNo) {
    selectedOrder.value = null
    return
  }
  selectedOrder.value = [...orderOptionMap.values()].find((o) => o.orderNo === form.orderNo) || null
  if (!selectedOrder.value) return
  batchOptions.value = (selectedOrder.value.batches || []).filter((b: any) => b.status !== 'cancelled' && b.status !== 'completed')
  try {
    const res: any = await productionApi.orderRoute(selectedOrder.value.id)
    routeSteps.value = res.data.route?.processes || []
  } catch {
    /* ignore */
  }
  await onReportQuery()
}

// 员工下拉
const employeeOptions = ref<any[]>([])
const employeeLoading = ref(false)
async function loadEmployees(keyword: string = '') {
  employeeLoading.value = true
  try {
    const res: any = await productionApi.employees({ keyword })
    employeeOptions.value = res.data.items || res.data || []
  } catch {
    /* ignore */
  } finally {
    employeeLoading.value = false
  }
}

async function handleSave() {
  if (!form.batchId) { ElMessage.warning('请选择批次'); return }
  if (!form.processStepId) { ElMessage.warning('请选择工序'); return }
  if (!form.reportBy) { ElMessage.warning('请选择员工'); return }
  if (!form.quantity || form.quantity <= 0) { ElMessage.warning('请输入完成数量'); return }
  if (!form.reportTime) { ElMessage.warning('请选择日期'); return }
  submitting.value = true
  try {
    await productionApi.reportBatch(form.batchId, {
      processStepId: form.processStepId,
      quantity: form.quantity,
      scrapQty: form.scrapQty || 0,
      workHours: form.workHours || 0,
      reportTime: form.reportTime,
      reportBy: form.reportBy,
      remark: form.remark || undefined,
    })
    ElMessage.success('报工成功')
    form.quantity = 0
    form.scrapQty = 0
    form.workHours = 0
    form.remark = ''
    form.reportTime = nowDateTime()
    await loadReports()
    // 刷新批次状态
    const res: any = await productionApi.orders({ pageSize: 100, orderNo: form.orderNo })
    registerOrderOptions(res.data.items || [])
    selectedOrder.value = [...orderOptionMap.values()].find((o) => o.orderNo === form.orderNo) || selectedOrder.value
    batchOptions.value = (selectedOrder.value?.batches || []).filter((b: any) => b.status !== 'cancelled' && b.status !== 'completed')
    if (form.batchId && !batchOptions.value.some((b: any) => b.id === form.batchId)) form.batchId = null
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

// ===== 报表区 =====
const reportQuery = reactive({ page: 1, pageSize: 20 })
const reportLoading = ref(false)
const reports = ref<any[]>([])
const reportTotal = ref(0)

async function loadReports() {
  if (!form.batchId) {
    reports.value = []
    reportTotal.value = 0
    reportLoading.value = false
    return
  }
  reportLoading.value = true
  try {
    const params: any = { page: reportQuery.page, pageSize: reportQuery.pageSize, batchId: form.batchId }
    const res: any = await productionApi.reports(params)
    reports.value = res.data.items
    reportTotal.value = res.data.total
  } finally {
    reportLoading.value = false
  }
}

async function onReportQuery() {
  reportQuery.page = 1
  await loadReports()
}

onMounted(async () => {
  const qOrderNo = String(route.query.orderNo || '')
  await Promise.all([loadOrderOptions(qOrderNo), loadEmployees()])
  if (qOrderNo) {
    form.orderNo = qOrderNo
    await onOrderChange()
  }
})
</script>

<template>
  <div class="page-container">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="table-toolbar">
        <span class="toolbar-title">员工报工</span>
      </div>

      <el-form :model="form" label-width="90px" class="report-form">
        <div class="form-grid">
          <el-form-item label="生产订单">
            <el-select v-model="form.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单" style="width: 100%" @change="onOrderChange">
              <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
            </el-select>
          </el-form-item>
          <el-form-item label="批次">
            <el-select v-model="form.batchId" clearable placeholder="选择批次" style="width: 100%" @change="onReportQuery">
              <el-option v-for="b in batchOptions" :key="b.id" :label="`第${b.batchNo}批（计划 ${b.quantity}）`" :value="b.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="工序">
            <el-select v-model="form.processStepId" filterable placeholder="选择工序（必选）" style="width: 100%">
              <el-option v-for="s in routeSteps" :key="s.id" :label="`${s.code} ${s.name}`" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="员工">
            <el-select v-model="form.reportBy" filterable remote clearable reserve-keyword :remote-method="loadEmployees" :loading="employeeLoading" placeholder="选择员工" style="width: 100%">
              <el-option v-for="u in employeeOptions" :key="u.id" :label="`${u.realName}（${u.username}）`" :value="u.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="完成数量">
            <el-input-number v-model="form.quantity" :min="0" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="不良品数">
            <el-input-number v-model="form.scrapQty" :min="0" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="操作时间(h)">
            <el-input-number v-model="form.workHours" :min="0" :precision="2" :step="0.1" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="日期">
            <el-date-picker v-model="form.reportTime" type="datetime" value-format="YYYY-MM-DDTHH:mm" style="width: 100%" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" clearable placeholder="选填" />
          </el-form-item>
        </div>
        <div class="form-actions">
          <el-button :loading="submitting" type="primary" @click="handleSave"><el-icon><Check /></el-icon>保存报工</el-button>
          <el-button @click="Object.assign(form, { quantity: 0, scrapQty: 0, workHours: 0, remark: '' })">清空</el-button>
        </div>
      </el-form>
    </div>

    <div class="page-card">
      <div class="sub-toolbar">
        <span class="sub-title">明细流水 <span v-if="form.batchId" class="wo-hint">（当前批次：第{{ batchOptions.find((b: any) => b.id === form.batchId)?.batchNo }}批）</span></span>
      </div>
      <el-table :data="reports" v-loading="reportLoading" size="small" stripe max-height="420">
        <el-table-column label="报工时间" width="150">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ String(row.reportTime).slice(0, 16) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="批次" width="90">
          <template #default="{ row }">第{{ row.batch?.batchNo }}批</template>
        </el-table-column>
        <el-table-column label="工序" min-width="120">
          <template #default="{ row }">{{ row.processStep ? `${row.processStep.code} ${row.processStep.name}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="员工" width="120">
          <template #default="{ row }">{{ row.reporter?.realName ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="完成数量" width="90" align="center" />
        <el-table-column prop="scrapQty" label="不良" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.scrapQty > 0" style="color: var(--el-color-danger)">{{ row.scrapQty }}</span>
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column prop="workHours" label="工时(h)" width="90" align="center" />
        <el-table-column prop="remark" label="备注" min-width="130" show-overflow-tooltip />
      </el-table>

      <div style="margin-top: 12px; display: flex; justify-content: flex-end">
        <el-pagination v-model:current-page="reportQuery.page" v-model:page-size="reportQuery.pageSize" :total="reportTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" background @change="onReportQuery" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0 16px;
}
.form-actions {
  padding-left: 90px;
}
.sub-toolbar {
  margin-bottom: 8px;
}
.sub-title {
  font-size: 13px;
  font-weight: 600;
  color: #26303d;
}
.wo-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-color-primary);
}
</style>
