<script setup lang="ts">
import { ref } from 'vue'
import { useECharts, axisLabelStyle, splitLineStyle, gridOpt } from '../../../../composables/useECharts'
import { reportApi } from '../../../../api'

const loading = ref(false)
const range = ref<[string, string] | null>(null)
const groupBy = ref('month')
const data = ref<any>(null)

const amountRef = ref<HTMLElement>()
const statusRef = ref<HTMLElement>()
const custRef = ref<HTMLElement>()
const rateRef = ref<HTMLElement>()

const { mount, clear } = useECharts()

const statusMeta: Record<string, { name: string; color: string }> = {
  draft: { name: '草稿', color: '#6b7684' },
  confirmed: { name: '已确认', color: '#3a7ca5' },
  in_production: { name: '生产中', color: '#3f8fe0' },
  completed: { name: '已完成', color: '#3e7c4f' },
  shipped: { name: '已发货', color: '#7f8c3d' },
  cancelled: { name: '已取消', color: '#a84a4a' },
}

const fmtMoney = (v: number) => `¥${Number(v).toLocaleString()}`

function renderCharts() {
  clear()
  if (!data.value) return
  const { amountSeries, onTimeRateTrend, customerRank, statusDist } = data.value

  mount(amountRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => fmtMoney(Number(v)) },
    grid: gridOpt,
    xAxis: { type: 'category', data: amountSeries.map((p: any) => p.period), axisLabel: axisLabelStyle },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    series: [{ name: '订单金额', type: 'bar', barMaxWidth: 32, data: amountSeries.map((p: any) => p.value), itemStyle: { color: '#2f6b8f', borderRadius: [3, 3, 0, 0] } }],
  })

  mount(statusRef.value, {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      name: '订单状态',
      type: 'pie',
      radius: ['38%', '64%'],
      center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}: {c}' },
      data: statusDist.map((s: any) => ({
        value: s.count,
        name: statusMeta[s.status]?.name ?? s.status,
        itemStyle: { color: statusMeta[s.status]?.color },
      })),
    }],
  })

  mount(custRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => fmtMoney(Number(v)) },
    grid: gridOpt,
    xAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    yAxis: { type: 'category', data: customerRank.map((r: any) => r.name).reverse(), axisLabel: axisLabelStyle },
    series: [{ type: 'bar', barMaxWidth: 18, data: customerRank.map((r: any) => r.value).reverse(), itemStyle: { color: '#3f8fe0', borderRadius: [0, 3, 3, 0] } }],
  })

  mount(rateRef.value, {
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v}%` },
    grid: gridOpt,
    xAxis: { type: 'category', data: onTimeRateTrend.map((p: any) => p.period), boundaryGap: false, axisLabel: axisLabelStyle },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { ...axisLabelStyle, formatter: '{value}%' }, splitLine: splitLineStyle },
    series: [{ name: '准时交付率', type: 'line', smooth: true, data: onTimeRateTrend.map((p: any) => p.value), areaStyle: { opacity: 0.12 }, itemStyle: { color: '#3e7c4f' } }],
  })
}

async function loadData() {
  loading.value = true
  try {
    const params: any = { groupBy: groupBy.value }
    if (range.value && range.value[0]) { params.from = range.value[0]; params.to = range.value[1] }
    const res: any = await reportApi.sales(params)
    data.value = res.data
    renderCharts()
  } finally { loading.value = false }
}

loadData()
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">销售与交期报表</span>
        <div style="flex: 1" />
        <el-date-picker v-model="range" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" size="small" style="width: 260px" />
        <el-select v-model="groupBy" size="small" style="width: 96px">
          <el-option label="按日" value="day" />
          <el-option label="按周" value="week" />
          <el-option label="按月" value="month" />
        </el-select>
        <el-button type="primary" size="small" @click="loadData">查询</el-button>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">订单总额</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ fmtMoney(data?.summary?.totalAmount ?? 0) }}</div>
          <div class="stat-sub">订单数 {{ data?.summary?.orderCount ?? 0 }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">完成率</div>
          <div class="stat-value" style="color: var(--el-color-success)">{{ data?.summary?.completedRate ?? 0 }}%</div>
          <div class="stat-sub">已完成 {{ data?.summary?.completedCount ?? 0 }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-label">准时交付率</div>
          <div class="stat-value" style="color: var(--erp-amber)">{{ data?.summary?.onTimeRate ?? 100 }}%</div>
          <div class="stat-sub">已完工订单交期达成占比</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card red">
          <div class="stat-label">逾期订单</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ data?.summary?.overdueCount ?? 0 }}</div>
          <div class="stat-sub">已超过交期未完成</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">订单金额趋势</div>
          <div ref="amountRef" style="height: 280px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">订单状态分布</div>
          <div ref="statusRef" style="height: 280px"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">客户金额排行 TOP10</div>
          <div ref="custRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">准时交付率趋势</div>
          <div ref="rateRef" style="height: 300px"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>