<script setup lang="ts">
import { ref } from 'vue'
import type { EChartsOption } from 'echarts'
import { useECharts, axisLabelStyle, splitLineStyle, gridOpt } from '../../../../composables/useECharts'
import { reportApi } from '../../../../api'

const loading = ref(false)
const range = ref<[string, string] | null>(null)
const groupBy = ref('month')
const data = ref<any>(null)

const trendRef = ref<HTMLElement>()
const yieldRef = ref<HTMLElement>()
const wsRef = ref<HTMLElement>()
const opRef = ref<HTMLElement>()

const { mount, clear } = useECharts()

function renderCharts() {
  clear()
  if (!data.value) return
  const { outputSeries, scrapSeries, yieldSeries, workstationRank, operatorRank } = data.value

  mount(trendRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, data: ['产量', '报废'] },
    grid: gridOpt,
    xAxis: { type: 'category', data: outputSeries.map((p: any) => p.period), axisLabel: axisLabelStyle },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    series: [
      { name: '产量', type: 'bar', barMaxWidth: 30, data: outputSeries.map((p: any) => p.value), itemStyle: { color: '#2f6b8f' } },
      { name: '报废', type: 'bar', barMaxWidth: 30, data: scrapSeries.map((p: any) => p.value), itemStyle: { color: '#c4543c' } },
    ],
  })

  mount(yieldRef.value, {
    tooltip: { trigger: 'axis' },
    grid: gridOpt,
    xAxis: { type: 'category', data: yieldSeries.map((p: any) => p.period), boundaryGap: false, axisLabel: axisLabelStyle },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { ...axisLabelStyle, formatter: '{value}%' }, splitLine: splitLineStyle },
    series: [{ name: '良率', type: 'line', smooth: true, data: yieldSeries.map((p: any) => p.value), areaStyle: { opacity: 0.12 }, itemStyle: { color: '#3e7c4f' } }],
  })

  const rankOption = (rows: any[], color: string): EChartsOption => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: gridOpt,
    xAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    yAxis: { type: 'category', data: rows.map((r: any) => r.name).reverse(), axisLabel: axisLabelStyle },
    series: [{ type: 'bar', barMaxWidth: 18, data: rows.map((r: any) => r.value).reverse(), itemStyle: { color, borderRadius: [0, 3, 3, 0] } }],
  })

  mount(wsRef.value, rankOption(workstationRank, '#2f6b8f'))
  mount(opRef.value, rankOption(operatorRank, '#a2572a'))
}

async function loadData() {
  loading.value = true
  try {
    const params: any = { groupBy: groupBy.value }
    if (range.value && range.value[0]) { params.from = range.value[0]; params.to = range.value[1] }
    const res: any = await reportApi.production(params)
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
        <span class="toolbar-title">生产报表</span>
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
          <div class="stat-label">报工次数</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ data?.summary?.reportCount ?? '-' }}</div>
          <div class="stat-sub">时间段内报工流水</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">产出总数</div>
          <div class="stat-value" style="color: var(--el-color-success)">{{ data?.summary?.outputQty ?? 0 }}</div>
          <div class="stat-sub">报工合格数量合计</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card red">
          <div class="stat-label">报废数量</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ data?.summary?.scrapQty ?? 0 }}</div>
          <div class="stat-sub">报废数量合计</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-label">良率</div>
          <div class="stat-value" style="color: var(--erp-amber)">{{ data?.summary?.yieldRate ?? 100 }}%</div>
          <div class="stat-sub">合格 / 报工总量</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">产量与报废趋势</div>
          <div ref="trendRef" style="height: 280px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">良率趋势</div>
          <div ref="yieldRef" style="height: 280px"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">工位产出排行</div>
          <div ref="wsRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">操作员产出排行</div>
          <div ref="opRef" style="height: 300px"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>