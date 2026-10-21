<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { purchaseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.arrival()
    list.value = res.data || []
  } finally { loading.value = false }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">在途/待收货明细</span>
        <div style="flex: 1" />
        <el-button type="primary" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="采购单号" width="140" />
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="订购量" width="90" align="right" />
        <el-table-column prop="receivedQty" label="已收" width="80" align="right" />
        <el-table-column prop="remainingQty" label="待收" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: 'var(--el-color-danger)', fontWeight: 600 }">{{ row.remainingQty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="截止日期" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.isOverdue" type="danger" size="small" effect="dark">{{ row.expectedDate?.slice(0, 10) || '-' }} 逾期</el-tag>
            <span v-else>{{ row.expectedDate?.slice(0, 10) || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="(row.receivedQty ?? 0) > 0 ? 'warning' : 'info'" size="small">
              {{ (row.receivedQty ?? 0) > 0 ? '部分收货' : '待收货' }}
            </el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有待收货的采购明细" :image-size="56">
            <div class="empty-tip">已确认且存在未收完明细的采购单才会在途；全部到货后此页为空</div>
          </el-empty>
        </template>
      </el-table>
    </div>
  </div>
</template>