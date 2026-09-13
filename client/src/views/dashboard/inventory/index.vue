<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dashboardApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const data = ref<any>(null)

async function loadData() {
  loading.value = true
  try {
    const res: any = await dashboardApi.inventory()
    data.value = res.data
  } finally { loading.value = false }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">库存看板</span>
        <div style="flex: 1" />
        <el-button type="primary" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-row v-loading="loading" :gutter="16">
        <el-col :span="8">
          <div class="stat-card">
            <div class="stat-label">物料种类</div>
            <div class="stat-value" style="color: var(--el-color-primary)">{{ data?.summary?.totalMaterials ?? '-' }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="stat-card">
            <div class="stat-label">库存总量</div>
            <div class="stat-value" style="color: var(--el-color-success)">{{ data?.summary?.totalValue ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="stat-card">
            <div class="stat-label">低库存物料</div>
            <div class="stat-value" style="color: var(--el-color-danger)">{{ data?.summary?.lowStockCount ?? 0 }}</div>
          </div>
        </el-col>
      </el-row>
    </div>

    <div class="page-card">
      <div class="toolbar-title" style="margin-bottom: 12px">各仓库库存明细</div>
      <el-table :data="data?.stocks || []" v-loading="loading" stripe size="small" max-height="520">
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">{{ row.material.code }} - {{ row.material.name }}</template>
        </el-table-column>
        <el-table-column label="类别" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ materialCategoryLabel(row.material.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="现存量" width="90" />
        <el-table-column prop="reservedQty" label="预占" width="80" />
        <el-table-column prop="availableQty" label="可用" width="90" />
        <el-table-column label="安全库存" width="90">
          <template #default="{ row }">{{ row.material.safetyStock ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="预警" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.isLow" type="danger" size="small">低库存</el-tag>
            <el-tag v-else type="success" size="small" effect="plain">正常</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>