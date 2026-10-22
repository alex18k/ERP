<script setup lang="ts">
import { ref } from 'vue'
import { dashboardApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
  { label: '生产中', value: 'in_production', type: 'warning' },
  { label: '已完工', value: 'completed', type: 'success' },
  { label: '已发货', value: 'shipped', type: '' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

const statusType = (v: string) => statusOptions.find((o) => o.value === v)?.type || 'info'
const statusLabel = (v: string) => statusOptions.find((o) => o.value === v)?.label || v

async function loadData() {
  loading.value = true
  try {
    const res: any = await dashboardApi.orderTracking()
    list.value = res.data
  } finally { loading.value = false }
}

loadData()
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">订单追踪看板</span>
        <div style="flex: 1" />
        <el-button type="primary" size="small" @click="loadData">刷新</el-button>
      </div>
    </div>

    <div class="page-card">
      <el-table :data="list" size="small">
        <el-table-column prop="orderNo" label="订单号" width="150">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums">{{ row.orderNo }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="130" show-overflow-tooltip />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deliveryDate" label="交期" width="110" align="center">
          <template #default="{ row }">{{ row.deliveryDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="totalItemQty" label="数量" width="90" align="center" />
        <el-table-column label="生产进度" min-width="180">
          <template #default="{ row }">
            <el-progress :percentage="row.productionProgress" :stroke-width="14" :color="row.isOverdue ? 'var(--el-color-danger)' : '#2f6b8f'" />
          </template>
        </el-table-column>
        <el-table-column label="逾期" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isOverdue" type="danger" size="small">逾期</el-tag>
            <span v-else style="color: var(--erp-steel)">—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length" description="暂无订单数据" :image-size="60" />
    </div>
  </div>
</template>