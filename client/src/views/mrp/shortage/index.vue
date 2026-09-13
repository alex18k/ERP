<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { mrpApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const router = useRouter()
const loading = ref(false)
const latestRun = ref<any>(null)
const shortages = ref<any[]>([])

async function loadData() {
  loading.value = true
  try {
    const res: any = await mrpApi.shortage()
    latestRun.value = res.data.latestRun
    shortages.value = res.data.shortages || []
  } finally { loading.value = false }
}

function fontColor(n: number) {
  if (n >= 50) return 'var(--el-color-danger)'
  if (n >= 10) return 'var(--el-color-warning)'
  return 'var(--el-color-success)'
}

function statusLabel(s: string) {
  return { pending: '待处理', suggested: '已建议', purchased: '已采购', closed: '已关闭' }[s] || s
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <el-card v-if="latestRun" class="mb-16">
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="最近运算">#{{ latestRun.runNo }}</el-descriptions-item>
        <el-descriptions-item label="订单数">{{ latestRun.orderCount }}</el-descriptions-item>
        <el-descriptions-item label="缺料数">
          <el-tag type="danger">{{ latestRun.shortageCount }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="运算时间">{{ latestRun.completedAt }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">当前缺料清单</span>
        <div style="flex: 1" />
        <el-button type="primary" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button type="success" @click="router.push('/mrp/purchase-suggestion')">查看采购建议</el-button>
      </div>

      <el-alert
        v-if="shortages.length === 0"
        type="success" :closable="false" show-icon
        title="暂无缺料，库存满足所有已知需求。"
        style="margin-bottom: 12px"
      />

      <el-table :data="shortages" v-loading="loading" stripe>
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">
            <div>{{ row.material.code }} - {{ row.material.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="90">
          <template #default="{ row }">{{ materialCategoryLabel(row.material.category) }}</template>
        </el-table-column>
        <el-table-column prop="grossDemand" label="毛需求" width="90" />
        <el-table-column prop="stockQuantity" label="可用库存" width="90" />
        <el-table-column prop="inTransit" label="在途量" width="80" />
        <el-table-column prop="safetyStock" label="安全库存" width="90" />
        <el-table-column label="净需求" width="110">
          <template #default="{ row }">
            <span :style="{ color: fontColor(row.netDemand), fontWeight: 600 }">{{ row.netDemand }}</span>
          </template>
        </el-table-column>
        <el-table-column label="受影响订单" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="o in row.affectedOrders" :key="o.orderId" size="small" type="info" style="margin-right: 4px">
              {{ o.orderNo }} ×{{ o.quantity }}
            </el-tag>
            <el-tag v-if="!row.affectedOrders?.length" size="small" type="info" effect="plain">-</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'closed' ? 'success' : 'warning'" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>