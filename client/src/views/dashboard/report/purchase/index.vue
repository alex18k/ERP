<script setup lang="ts">
import { ref } from 'vue'
import { useECharts, axisLabelStyle, splitLineStyle, gridOpt } from '../../../../composables/useECharts'
import { reportApi } from '../../../../api'

const loading = ref(false)
const range = ref<[string, string] | null>(null)
const groupBy = ref('month')
const data = ref<any>(null)

const amountRef = ref<HTMLElement>()
const supRef = ref<HTMLElement>()
const rateRef = ref<HTMLElement>()

const { mount, clear } = useECharts()

const fmtMoney = (v: number) => `¥${Number(v).toLocaleString()}`

function renderCharts() {
  clear()
  if (!data.value) return
  const { amountSeries, arrivalRateTrend, supplierRank } = data.value

  mount(amountRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => fmtMoney(Number(v)) },
    grid: gridOpt,
    xAxis: { type: 'category', data: amountSeries.map((p: any) => p.period), axisLabel: axisLabelStyle },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    series: [{ name: '采购金额', type: 'bar', barMaxWidth: 32, data: amountSeries.map((p: any) => p.value), itemStyle: { color: '#3a7ca5', borderRadius: [3, 3, 0, 0] } }],
  })

  mount(supRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => fmtMoney(Number(v)) },
    grid: gridOpt,
    xAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    yAxis: { type: 'category', data: supplierRank.map((r: any) => r.name).reverse(), axisLabel: axisLabelStyle },
    series: [{ type: 'bar', barMaxWidth: 18, data: supplierRank.map((r: any) => r.value).reverse(), itemStyle: { color: '#2f6b8f', borderRadius: [0, 3, 3, 0] } }],
  })

  mount(rateRef.value, {
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v}%` },
    grid: gridOpt,
    xAxis: { type: 'category', data: arrivalRateTrend.map((p: any) => p.period), boundaryGap: false, axisLabel: axisLabelStyle },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { ...axisLabelStyle, formatter: '{value}%' }, splitLine: splitLineStyle },
    series: [{ name: '到货准时率', type: 'line', smooth: true, data: arrivalRateTrend.map((p: any) => p.value), areaStyle: { opacity: 0.12 }, itemStyle: { color: '#3e7c4f' } }],
  })
}

async function loadData() {
  loading.value = true
  try {
    const params: any = { groupBy: groupBy.value }
    if (range.value && range.value[0]) { params.from = range.value[0]; params.to = range.value[1] }
    const res: any = await reportApi.purchase(params)
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
        <span class="toolbar-title">采购报表</span>
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
          <div class="stat-label">采购总额</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ fmtMoney(data?.summary?.totalAmount ?? 0) }}</div>
          <div class="stat-sub">采购单数 {{ data?.summary?.orderCount ?? 0 }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-label">在途金额</div>
          <div class="stat-value" style="color: var(--erp-amber)">{{ fmtMoney(data?.summary?.inTransitAmount ?? 0) }}</div>
          <div class="stat-sub">未收货 / 部分收货</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">已收货单数</div>
          <div class="stat-value" style="color: var(--el-color-success)">{{ data?.summary?.receivedCount ?? 0 }}</div>
          <div class="stat-sub">已入库采购单</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card green">
          <div class="stat-label">供应商数</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ data?.supplierRank?.length ?? 0 }}</div>
          <div class="stat-sub">统计范围内供应商</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">采购金额趋势</div>
          <div ref="amountRef" style="height: 280px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">到货准时率趋势</div>
          <div ref="rateRef" style="height: 280px"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">供应商采购金额排行 TOP10</div>
          <div ref="supRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">供应商到货准时率</div>
          <el-table :data="data?.supplierRate ?? []" size="small" style="margin-top: 4px" max-height="300">
            <el-table-column prop="name" label="供应商" min-width="120" show-overflow-tooltip />
            <el-table-column prop="total" label="到货单数" width="90" align="center" />
            <el-table-column label="准时率" width="110" align="center">
              <template #default="{ row }">
                <el-tag :type="row.rate >= 90 ? 'success' : row.rate >= 70 ? 'warning' : 'danger'" size="small">{{ row.rate }}%</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>