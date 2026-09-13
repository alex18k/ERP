<script setup lang="ts">
import { ref } from 'vue'
import { productionApi } from '../../../../api'

const loading = ref(false)
const total = ref(0)
const page = ref(1)
const items = ref<any[]>([])
const summary = ref({ count: 0, output: 0, scrap: 0 })

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.reports({ page: page.value, pageSize: 20 })
    items.value = res.data.items
    total.value = res.data.total
    summary.value.count = res.data.total ?? 0
    summary.value.output = res.data.items.reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
    summary.value.scrap = res.data.items.reduce((s: number, r: any) => s + (r.scrapQty ?? 0), 0)
  } finally { loading.value = false }
}

loadData()
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">报工记录</span>
        <div style="flex: 1" />
        <el-button type="primary" size="small" @click="loadData">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">报工记录数</div>
          <div class="stat-value" style="color: var(--el-color-primary)">{{ summary.count }}</div>
          <div class="stat-sub">全部报工流水</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">当前页产出</div>
          <div class="stat-value" style="color: var(--el-color-success)">{{ summary.output }}</div>
          <div class="stat-sub">本页报工数量合计</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card red">
          <div class="stat-label">当前页报废</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ summary.scrap }}</div>
          <div class="stat-sub">本页报废数量合计</div>
        </div>
      </el-col>
    </el-row>

    <div class="page-card">
      <el-table :data="items" size="small">
        <el-table-column prop="reportTime" label="报工时间" width="170">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ row.reportTime }}</span>
          </template>
        </el-table-column>
        <el-table-column label="产品物料" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.workOrder?.productionOrder?.material?.name ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="加工单号" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.workOrder?.orderNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="报工数量" width="90" align="center" />
        <el-table-column prop="scrapQty" label="报废数量" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.scrapQty > 0" style="color: var(--el-color-danger)">{{ row.scrapQty }}</span>
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column prop="materialUsed" label="耗用物料" width="90" align="center" />
        <el-table-column label="操作员" width="110" align="center">
          <template #default="{ row }">{{ row.reporter?.realName ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
      </el-table>
      <div style="margin-top: 12px; display: flex; justify-content: flex-end">
        <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" background @current-change="loadData" />
      </div>
    </div>
  </div>
</template>