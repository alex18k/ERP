<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { productionApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const query = reactive({ startDate: '', endDate: '' })

const statusColor: Record<string, string> = {
  pending: '#909399',
  in_progress: '#e6a23c',
  completed: '#67c23a',
  cancelled: '#f56c6c',
  paused: '#e6a23c',
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.gantt(query)
    list.value = res.data || []
  } finally { loading.value = false }
}

function startTime(row: any) {
  return row.startTime ? new Date(row.startTime) : new Date()
}

function endTime(row: any) {
  return row.endTime ? new Date(row.endTime) : new Date(startTime(row).getTime() + 24 * 3600 * 1000)
}

function leftPct(row: any) {
  const list = summary()
  if (list.total === 0) return 0
  const start = list.min
  const span = list.max - list.min
  return ((startTime(row).getTime() - start) / span) * 100
}

function widthPct(row: any) {
  const list = summary()
  if (list.total === 0) return 100
  const span = list.max - list.min
  return ((endTime(row).getTime() - startTime(row).getTime()) / span) * 100
}

function summary() {
  if (!list.value.length) return { min: Date.now(), max: Date.now() + 86400000, total: 0 }
  const times = list.value.flatMap((r: any) => [startTime(r).getTime(), endTime(r).getTime()])
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = max - min || 86400000
  return { min, max: min + span, total: span }
}

function fmt(d: Date) {
  return d.toLocaleDateString('zh-CN')
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.startDate" placeholder="开始日期" type="date" clearable style="width: 160px" />
        <el-input v-model="query.endDate" placeholder="结束日期" type="date" clearable style="width: 160px" />
        <el-button type="primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-alert type="info" :closable="false" show-icon title="按工位×工序展示加工单的时间排程。条形长度对应计划/实际工时，颜色表示状态。" style="margin-bottom: 16px" />

      <el-table :data="list" v-loading="loading" size="small" stripe>
        <el-table-column label="工位" width="110">
          <template #default="{ row }">{{ row.workStationName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="加工单号" width="140" />
        <el-table-column label="工序" width="110">
          <template #default="{ row }">{{ row.processStepName || '-' }}</template>
        </el-table-column>
        <el-table-column label="物料" min-width="130">
          <template #default="{ row }">{{ row.materialName }}</template>
        </el-table-column>
        <el-table-column label="进度" width="180">
          <template #default="{ row }">
            <div class="gantt-track">
              <div class="gantt-bar" :style="{
                left: leftPct(row) + '%',
                width: Math.max(widthPct(row), 3) + '%',
                background: statusColor[row.status] || '#909399',
              }">
                {{ Math.max(Math.round(widthPct(row)), 8) >= 12 ? `${row.actualQty}/${row.plannedQty}` : '' }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="起止" width="220">
          <template #default="{ row }">{{ fmt(startTime(row)) }} ~ {{ fmt(endTime(row)) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :color="statusColor[row.status]" size="small" style="color: #fff; border: none">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.gantt-track {
  position: relative;
  height: 22px;
  border-radius: 3px;
  background: #f0f2f5;
}
.gantt-bar {
  position: absolute;
  top: 2px;
  height: 18px;
  border-radius: 3px;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
</style>