<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { dashboardApi } from '../../../api'

const loading = ref(false)
const data = ref<any>(null)
const pieRef = ref<HTMLElement>()
let pieChart: any = null

function mountPie() {
  if (!pieRef.value || !data.value) return
  pieChart = echarts.init(pieRef.value)
  const { orderStats } = data.value
  pieChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      name: '订单状态',
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}: {c}' },
      data: [
        { value: orderStats.total - orderStats.completed - orderStats.inProgress, name: '未开始', itemStyle: { color: '#6b7684' } },
        { value: orderStats.inProgress, name: '生产中', itemStyle: { color: '#3b8ae0' } },
        { value: orderStats.completed, name: '已完成', itemStyle: { color: '#3e7c4f' } },
      ],
    }],
  })
}

function resize() {
  pieChart?.resize()
}

onMounted(async () => {
  loading.value = true
  try {
    const res: any = await dashboardApi.executive()
    data.value = res.data
    mountPie()
  } finally { loading.value = false }
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  pieChart?.dispose()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">管理驾驶舱</span>
        <div style="flex: 1" />
        <el-button type="primary" size="small" @click="loading = true, dashboardApi.executive().then((r: any) => (data = r.data)).finally(() => { loading = false; mountPie() })">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
      </div>

      <div class="kpi-band" v-loading="loading">
        <div class="kpi">
          <div class="kpi-label">订单总数</div>
          <div class="kpi-value">{{ data?.orderStats?.total ?? '-' }}</div>
          <div class="kpi-sub">已完成 {{ data?.orderStats?.completed ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">订单完成率</div>
          <div class="kpi-value" style="color: var(--el-color-success)">{{ data?.orderStats?.completionRate ?? 0 }}%</div>
          <div class="kpi-sub">生产中 {{ data?.orderStats?.inProgress ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">订单总额</div>
          <div class="kpi-value">¥{{ (data?.financial?.totalAmount ?? 0).toLocaleString() }}</div>
          <div class="kpi-sub">逾期订单 {{ data?.orderStats?.overdue ?? 0 }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">待处理告警</div>
          <div class="kpi-value" style="color: var(--el-color-warning)">{{ (data?.alerts?.shortageCount ?? 0) + (data?.alerts?.lowStockCount ?? 0) }}</div>
          <div class="kpi-sub">缺料 {{ data?.alerts?.shortageCount ?? 0 }} · 低库存 {{ data?.alerts?.lowStockCount ?? 0 }}</div>
        </div>
      </div>

      <div class="kpi-band" v-loading="loading" style="margin-top: 16px">
        <div class="kpi">
          <div class="kpi-label">已完工产值</div>
          <div class="kpi-value" style="color: var(--erp-amber)">¥{{ (data?.operations?.outputValue ?? 0).toLocaleString() }}</div>
          <div class="kpi-sub">已完工 + 已发货订单金额</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">准时交付率</div>
          <div class="kpi-value" style="color: var(--el-color-success)">{{ data?.operations?.onTimeRate ?? 0 }}%</div>
          <div class="kpi-sub">完工订单交期内达成占比</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">累计良率</div>
          <div class="kpi-value">{{ data?.operations?.yieldRate ?? 100 }}%</div>
          <div class="kpi-sub">报工总量扣报废占比</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">产能负荷</div>
          <div class="kpi-value" style="color: var(--el-color-danger)">{{ data?.operations?.capacityLoad ?? 0 }}%</div>
          <div class="kpi-sub">当前有任务工位占比</div>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="10">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">订单状态分布</div>
          <div ref="pieRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="14">
        <div class="page-card">
          <div class="toolbar-title" style="margin-bottom: 12px">核心指标</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="MRP最近运算">
              <span v-if="data?.lastMrpRun">#{{ data.lastMrpRun.runNo }}<br /><small>{{ data.lastMrpRun.completedAt }}</small></span>
              <span v-else>尚未运算</span>
            </el-descriptions-item>
            <el-descriptions-item label="最近缺料数">{{ data?.lastMrpRun?.shortageCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="进行中工单">{{ data?.alerts?.activeWorkOrders ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="低库存物料">{{ data?.alerts?.lowStockCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="缺料物料">{{ data?.alerts?.shortageCount ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="订单完成率">{{ data?.orderStats?.completionRate ?? 0 }}%</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
/* 商业级指标带：分隔线代替卡片堆叠 */
.kpi-band {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--erp-hairline);
  border-radius: 10px;
  background: var(--erp-surface);
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(18, 34, 58, 0.04), 0 6px 18px -6px rgba(18, 34, 58, 0.06);
}

.kpi {
  padding: 14px 18px;
  border-right: 1px solid var(--erp-hairline-2);
}

.kpi:last-child { border-right: none; }

.kpi-label {
  font-size: 12px;
  color: var(--erp-steel);
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.kpi-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
  color: #1a1f2a;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.kpi-sub {
  font-size: 12px;
  color: var(--erp-steel);
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .kpi-band { grid-template-columns: repeat(2, 1fr); }
  .kpi:nth-child(2) { border-right: none; }
  .kpi:nth-child(n + 3) { border-top: 1px solid var(--erp-hairline-2); }
}

@media (max-width: 640px) {
  .kpi-band { grid-template-columns: 1fr; }
  .kpi { border-right: none; border-bottom: 1px solid var(--erp-hairline-2); }
  .kpi:nth-child(n + 3) { border-top: none; }
  .kpi:last-child { border-bottom: none; }
}
</style>