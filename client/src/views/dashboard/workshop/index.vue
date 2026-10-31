<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { dashboardApi } from '../../../api'

const loading = ref(false)
const autoRefresh = ref(true)
const workshops = ref<any[]>([])
const summary = ref<any>({ inProgress: 0, pending: 0, todayReports: 0, todayCompleted: 0, overdue: 0 })
const orders = ref<any[]>([])
const workstations = ref<any[]>([])
const recentReports = ref<any[]>([])
const query = reactive<{ workshopId?: number; execStatus?: string }>({ execStatus: 'all' })

const statusOptions = [
  { label: '全部在制', value: 'all' },
  { label: '待开工', value: 'pending' },
  { label: '生产中', value: 'in_progress' },
  { label: '已完成', value: 'completed' },
  { label: '未排产', value: 'none' },
]

const execStatusMap: Record<string, { label: string; type: string }> = {
  none: { label: '未排产', type: 'info' },
  pending: { label: '待开工', type: 'info' },
  in_progress: { label: '生产中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
}

const stepStatusMap: Record<string, { label: string; type: string }> = {
  done: { label: '已完成', type: 'success' },
  current: { label: '当前', type: 'warning' },
  waiting: { label: '待加工', type: 'info' },
}

const stationStatusMap: Record<string, { label: string; type: string }> = {
  busy: { label: '加工中', type: 'warning' },
  pending: { label: '待开工', type: 'info' },
  idle: { label: '空闲', type: 'success' },
}

const execStatusLabel = (value: string) => execStatusMap[value]?.label ?? value
const execStatusType = (value: string) => execStatusMap[value]?.type ?? 'info'
const stepStatusLabel = (value: string) => stepStatusMap[value]?.label ?? value
const stepStatusType = (value: string) => stepStatusMap[value]?.type ?? 'info'
const stationStatusLabel = (value: string) => stationStatusMap[value]?.label ?? value
const stationStatusType = (value: string) => stationStatusMap[value]?.type ?? 'info'

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '-')
const fmtTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

let timer: ReturnType<typeof setInterval> | null = null
let disposed = false
let inFlight = false

async function loadData(silent = false) {
  if (inFlight) return
  inFlight = true
  if (!silent) loading.value = true
  try {
    const params: { workshopId?: number; execStatus?: string } = {}
    if (query.workshopId) params.workshopId = query.workshopId
    if (query.execStatus && query.execStatus !== 'all') params.execStatus = query.execStatus
    const res: any = await dashboardApi.workshop(params)
    workshops.value = res.data.workshops || []
    summary.value = res.data.summary
    orders.value = res.data.orders || []
    workstations.value = res.data.workstations || []
    recentReports.value = res.data.recentReports || []
  } catch {
    // 错误提示由 axios 拦截器统一处理，失败时保留上一次数据
  } finally {
    inFlight = false
    if (!silent) loading.value = false
  }
}

function startTimer() {
  if (disposed) return
  stopTimer()
  timer = setInterval(() => {
    if (!document.hidden) loadData(true)
  }, 30_000)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function toggleAutoRefresh() {
  if (autoRefresh.value) startTimer()
  else stopTimer()
}

onMounted(async () => {
  await loadData()
  if (autoRefresh.value && !disposed) startTimer()
})

onUnmounted(() => {
  disposed = true
  stopTimer()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">车间电子看板</span>
        <el-select
          v-model="query.workshopId"
          placeholder="全部车间"
          clearable
          style="width: 160px"
          @change="loadData"
        >
          <el-option v-for="workshop in workshops" :key="workshop.id" :label="workshop.name" :value="workshop.id" />
        </el-select>
        <el-select v-model="query.execStatus" style="width: 130px" @change="loadData">
          <el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-button type="primary" @click="loadData">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
        <div style="flex: 1" />
        <span class="text-muted" style="font-size: 12px">自动刷新</span>
        <el-switch v-model="autoRefresh" @change="toggleAutoRefresh" />
      </div>

      <div class="dashboard-grid">
        <div class="stat-card orange">
          <div class="stat-label">生产中</div>
          <div class="stat-value">{{ summary.inProgress }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">待开工</div>
          <div class="stat-value">{{ summary.pending }}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">今日报工</div>
          <div class="stat-value">{{ summary.todayReports }}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">今日完工</div>
          <div class="stat-value">{{ summary.todayCompleted }}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">逾期订单</div>
          <div class="stat-value">{{ summary.overdue }}</div>
        </div>
      </div>
    </div>

    <div class="page-card">
      <div class="toolbar-title" style="margin-bottom: 10px">生产订单进度</div>
      <el-table
        v-loading="loading"
        :data="orders"
        row-key="id"
        stripe
        size="small"
        empty-text="暂无在制生产订单"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="step-list">
              <div v-for="step in row.steps" :key="step.id" class="step-item" :class="step.status">
                <span class="step-seq">{{ step.sequence }}</span>
                <span class="step-name">{{ step.name }}</span>
                <span class="step-ws">{{ step.workstationName || '未指定工位' }}</span>
                <span class="step-qty">{{ step.reportedQty }} / {{ row.plannedQty || row.quantity }}</span>
                <el-tag size="small" :type="stepStatusType(step.status)">{{ stepStatusLabel(step.status) }}</el-tag>
              </div>
              <el-empty v-if="!row.steps.length" description="未排产或未配置工艺路线" :image-size="40" />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="orderNo" label="生产订单号" width="150">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ row.orderNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="产品" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column label="数量" width="120" align="right">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ row.reportedQty }} / {{ row.plannedQty || row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="currentStepName" label="当前工序" width="100" align="center">
          <template #default="{ row }">{{ row.currentStepName || '—' }}</template>
        </el-table-column>
        <el-table-column label="工序进度" min-width="190">
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress
                :percentage="row.progress"
                :stroke-width="12"
                :color="row.isOverdue ? 'var(--el-color-danger)' : '#2f6b8f'"
              />
              <span class="progress-text">{{ row.stepProgress.completed }}/{{ row.stepProgress.total }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="计划完工" width="105" align="center">
          <template #default="{ row }">{{ fmtDate(row.planEndDate) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="execStatusType(row.execStatus)">{{ execStatusLabel(row.execStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="逾期" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isOverdue" type="danger" size="small">逾期</el-tag>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-row :gutter="12">
      <el-col :xs="24" :lg="10">
        <div class="page-card" style="min-height: 260px">
          <div class="toolbar-title" style="margin-bottom: 10px">工位任务</div>
          <div v-loading="loading" class="station-grid">
            <div v-for="station in workstations" :key="station.id" class="station-card" :class="station.status">
              <div class="station-head">
                <span class="station-name">{{ station.name }}</span>
                <el-tag size="small" :type="stationStatusType(station.status)">
                  {{ stationStatusLabel(station.status) }}
                </el-tag>
              </div>
              <div class="station-meta">{{ station.code }} · {{ station.workshopName || '未分车间' }}</div>
              <div class="station-task">
                {{ station.status === 'idle' ? '暂无任务' : `${station.orderNo} · ${station.stepName}` }}
              </div>
            </div>
          </div>
          <el-empty v-if="!workstations.length" description="暂无启用工位" :image-size="50" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="14">
        <div class="page-card" style="min-height: 260px">
          <div class="toolbar-title" style="margin-bottom: 10px">今日报工动态</div>
          <el-table
            v-loading="loading"
            :data="recentReports"
            size="small"
            stripe
            max-height="300"
            empty-text="今日暂无报工"
          >
            <el-table-column label="时间" width="150">
              <template #default="{ row }">{{ fmtTime(row.reportTime) }}</template>
            </el-table-column>
            <el-table-column prop="reporterName" label="员工" width="90" />
            <el-table-column prop="orderNo" label="生产订单" width="145">
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums">{{ row.orderNo }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="stepName" label="工序" min-width="90" />
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
            <el-table-column prop="scrapQty" label="报废" width="70" align="right">
              <template #default="{ row }">
                <span :class="row.scrapQty > 0 ? 'text-overdue' : 'text-muted'">{{ row.scrapQty }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.progress-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-cell :deep(.el-progress) {
  flex: 1;
}

.progress-text {
  font-size: 12px;
  color: var(--erp-steel);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
  text-align: right;
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 16px 8px;
}

.step-item {
  display: grid;
  grid-template-columns: 28px 1fr 140px 110px 70px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--erp-hairline);
  border-left: 3px solid var(--erp-hairline);
  border-radius: 6px;
  font-size: 12px;
}

.step-item.done {
  border-left-color: var(--erp-green);
}

.step-item.current {
  border-left-color: var(--erp-amber);
  background: rgba(230, 162, 60, 0.06);
}

.step-seq {
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  background: var(--erp-hairline);
  color: var(--erp-steel);
  font-variant-numeric: tabular-nums;
}

.step-name {
  font-weight: 600;
  color: var(--erp-ink);
}

.step-ws,
.step-qty {
  color: var(--erp-steel);
  font-variant-numeric: tabular-nums;
}

.station-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}

.station-card {
  border: 1px solid var(--erp-hairline);
  border-left: 4px solid var(--erp-green);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--erp-surface);
}

.station-card.busy {
  border-left-color: var(--erp-amber);
}

.station-card.pending {
  border-left-color: var(--erp-steel);
}

.station-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.station-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--erp-ink);
}

.station-meta {
  margin-top: 4px;
  color: var(--erp-steel);
  font-size: 12px;
}

.station-task {
  margin-top: 6px;
  color: var(--erp-ink);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
