<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productionApi } from '../../../../api'

const employeeOptions = ref<any[]>([])
const employeeLoading = ref(false)
async function loadEmployees() {
  employeeLoading.value = true
  try {
    const res: any = await productionApi.reporters()
    employeeOptions.value = res.data || []
  } catch {
    /* ignore */
  } finally {
    employeeLoading.value = false
  }
}

const reportQuery = reactive({ page: 1, pageSize: 20, from: '', to: '', reporterId: '', orderNo: '' })
const reportLoading = ref(false)
const reports = ref<any[]>([])
const reportTotal = ref(0)

async function loadReports() {
  reportLoading.value = true
  try {
    const params: any = { page: reportQuery.page, pageSize: reportQuery.pageSize }
    if (reportQuery.from) params.from = reportQuery.from
    if (reportQuery.to) params.to = reportQuery.to
    if (reportQuery.reporterId) params.reporterId = Number(reportQuery.reporterId)
    if (reportQuery.orderNo) params.orderNo = reportQuery.orderNo
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

function resetReportQuery() {
  Object.assign(reportQuery, { page: 1, from: '', to: '', reporterId: '', orderNo: '' })
  onReportQuery()
}

async function exportExcel() {
  try {
    const params: any = {}
    if (reportQuery.from) params.from = reportQuery.from
    if (reportQuery.to) params.to = reportQuery.to
    if (reportQuery.reporterId) params.reporterId = Number(reportQuery.reporterId)
    if (reportQuery.orderNo) params.orderNo = reportQuery.orderNo
    await productionApi.exportEmployeeReports(params)
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败')
  }
}

onMounted(async () => {
  await Promise.all([loadEmployees()])
  await onReportQuery()
})
</script>

<template>
  <div class="page-container" v-loading="reportLoading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="table-toolbar">
        <span class="toolbar-title">员工报工报表</span>
        <div style="flex: 1" />
        <el-button size="small" @click="resetReportQuery">重置</el-button>
        <el-button size="small" type="success" plain @click="exportExcel"><el-icon><Download /></el-icon>导出Excel</el-button>
      </div>
      <div class="search-bar">
        <el-date-picker v-model="reportQuery.from" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width: 140px" />
        <el-date-picker v-model="reportQuery.to" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width: 140px" />
        <el-select v-model="reportQuery.reporterId" clearable filterable :loading="employeeLoading" placeholder="员工" style="width: 160px">
          <el-option v-for="u in employeeOptions" :key="u.id" :label="`${u.realName}（${u.username}）`" :value="u.id" />
        </el-select>
        <el-input v-model="reportQuery.orderNo" placeholder="生产订单号" clearable style="width: 170px" @keyup.enter="onReportQuery" />
        <el-button size="small" type="primary" @click="onReportQuery"><el-icon><Search /></el-icon>查询</el-button>
      </div>
    </div>

    <div class="page-card">
      <div class="sub-toolbar">
        <span class="sub-title">明细流水</span>
      </div>
      <el-table :data="reports" v-loading="reportLoading" size="small" stripe max-height="420">
        <el-table-column label="报工时间" width="150">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ String(row.reportTime).slice(0, 16) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="生产订单号" min-width="145" show-overflow-tooltip>
          <template #default="{ row }">{{ row.productionOrder?.orderNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="工序" width="120">
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
.sub-toolbar {
  margin-bottom: 8px;
}
.sub-title {
  font-size: 13px;
  font-weight: 600;
  color: #26303d;
}
</style>