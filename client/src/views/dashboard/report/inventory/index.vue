<script setup lang="ts">
import { ref } from 'vue'
import { useECharts, axisLabelStyle, splitLineStyle, gridOpt } from '../../../../composables/useECharts'
import { reportApi } from '../../../../api'
import { materialCategoryLabel } from '../../../../utils/category'

const loading = ref(false)
const range = ref<[string, string] | null>(null)
const groupBy = ref('month')
const data = ref<any>(null)

const flowRef = ref<HTMLElement>()
const topRef = ref<HTMLElement>()

const { mount, clear } = useECharts()

function renderCharts() {
  clear()
  if (!data.value) return
  const { inOutSeries, topStock } = data.value

  mount(flowRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, data: ['入库', '出库'] },
    grid: gridOpt,
    xAxis: { type: 'category', data: inOutSeries.map((p: any) => p.period), axisLabel: axisLabelStyle },
    yAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    series: [
      { name: '入库', type: 'bar', barMaxWidth: 26, data: inOutSeries.map((p: any) => p.in), itemStyle: { color: '#3e7c4f' } },
      { name: '出库', type: 'bar', barMaxWidth: 26, data: inOutSeries.map((p: any) => p.out), itemStyle: { color: '#c4543c' } },
    ],
  })

  mount(topRef.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: gridOpt,
    xAxis: { type: 'value', axisLabel: axisLabelStyle, splitLine: splitLineStyle },
    yAxis: { type: 'category', data: topStock.map((r: any) => r.name).reverse(), axisLabel: axisLabelStyle },
    series: [{ type: 'bar', barMaxWidth: 18, data: topStock.map((r: any) => r.value).reverse(), itemStyle: { color: '#2f6b8f', borderRadius: [0, 3, 3, 0] } }],
  })
}

async function loadData() {
  loading.value = true
  try {
    const params: any = { groupBy: groupBy.value }
    if (range.value && range.value[0]) { params.from = range.value[0]; params.to = range.value[1] }
    const res: any = await reportApi.inventory(params)
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
        <span class="toolbar-title">库存报表</span>
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
          <div class="stat-label">物料种类</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ data?.summary?.materialCount ?? '-' }}</div>
          <div class="stat-sub">有库存记录的物料</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">库存总量</div>
          <div class="stat-value" style="color: var(--el-color-success)">{{ data?.summary?.totalQty ?? 0 }}</div>
          <div class="stat-sub">全部库存数量合计</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card red">
          <div class="stat-label">低库存物料</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ data?.summary?.lowStockCount ?? 0 }}</div>
          <div class="stat-sub">低于安全库存</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-label">库存TOP物料</div>
          <div class="stat-value" style="color: var(--erp-amber)">{{ data?.topStock?.[0]?.value ?? 0 }}</div>
          <div class="stat-sub">库存最高的物料数量</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">出入库趋势</div>
          <div ref="flowRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">库存数量 TOP10</div>
          <div ref="topRef" style="height: 300px"></div>
        </div>
      </el-col>
    </el-row>

    <div class="page-card" style="margin-top: 16px">
      <div class="toolbar-title" style="margin-bottom: 12px">低库存预警清单</div>
      <el-table :data="data?.lowStock ?? []" size="small">
        <el-table-column prop="materialCode" label="物料编码" width="140" />
        <el-table-column prop="materialName" label="物料名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ materialCategoryLabel(row.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="warehouseName" label="仓库" width="120" />
        <el-table-column prop="quantity" label="现存量" width="100" align="center" />
        <el-table-column prop="safetyStock" label="安全库存" width="100" align="center" />
        <el-table-column prop="shortageQty" label="缺口数量" width="100" align="center">
          <template #default="{ row }">
            <span style="color: var(--el-color-danger)">{{ row.shortageQty }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!(data?.lowStock ?? []).length" description="暂无低库存预警" :image-size="60" />
    </div>
  </div>
</template>