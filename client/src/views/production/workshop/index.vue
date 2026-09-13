<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { productionApi, workshopApi } from '../../../api'

const loading = ref(false)
const workshops = ref<any[]>([])
const stations = ref<any[]>([])
const query = reactive({ workshopId: '' })

async function loadWorkshops() {
  const res: any = await workshopApi.list()
  workshops.value = res.data || []
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.workshop(query)
    stations.value = res.data || []
  } finally { loading.value = false }
}

onMounted(async () => {
  await loadWorkshops()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-select v-model="query.workshopId" placeholder="全部车间" clearable style="width: 200px" @change="loadData">
          <el-option v-for="w in workshops" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <span style="margin-left: 12px; color: var(--el-text-color-secondary); font-size: 13px">
          空闲 <el-tag type="success" size="small">●</el-tag>
          繁忙 <el-tag type="warning" size="small">●</el-tag>
        </span>
      </div>

      <el-row :gutter="16" v-loading="loading">
        <el-col v-for="s in stations" :key="s.id" :span="6" style="margin-bottom: 16px">
          <el-card :class="['station-card', s.status]">
            <template #header>
              <div class="station-header">
                <div>
                  <strong>{{ s.code }} - {{ s.name }}</strong>
                  <el-tag :type="s.status === 'busy' ? 'warning' : 'success'" size="small" style="margin-left: 8px">
                    {{ s.status === 'busy' ? '繁忙' : '空闲' }}
                  </el-tag>
                </div>
                <small style="color: var(--el-text-color-secondary)">{{ s.workshopName }}</small>
              </div>
            </template>
            <div v-if="s.currentWorkOrders?.length">
              <div v-for="wo in s.currentWorkOrders" :key="wo.id" class="wo-item">
                <div class="wo-title">
                  <span>{{ wo.orderNo }}</span>
                  <el-tag size="small" :type="wo.status === 'in_progress' ? 'warning' : 'info'">{{ wo.status === 'in_progress' ? '加工中' : '待开工' }}</el-tag>
                </div>
                <div class="wo-material">{{ wo.materialName }}</div>
                <el-progress :percentage="wo.progress" :stroke-width="8" style="margin-top: 6px" />
                <div class="wo-qty">完成 {{ wo.actualQty }} / {{ wo.plannedQty }}</div>
              </div>
            </div>
            <el-empty v-else :image-size="50" description="当前无任务" />
          </el-card>
        </el-col>
      </el-row>

      <el-empty v-if="!loading && stations.length === 0" description="暂无工位数据" />
    </div>
  </div>
</template>

<style scoped>
.station-card {
  --el-card-border-radius: 2px;
  --el-card-border-color: var(--erp-hairline);
  position: relative;
}

.station-card.is-busy::before,
.station-card.busy::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--erp-amber);
}

.station-card.busy {
  border-left-color: var(--erp-amber);
}

.station-card :deep(.el-card__header) {
  border-bottom: 1px solid var(--erp-hairline-2);
}

.wo-item + .wo-item {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--erp-hairline);
}

.wo-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wo-material {
  margin-top: 3px;
  font-size: 13px;
  color: var(--erp-steel);
}

.wo-qty {
  margin-top: 4px;
  font-size: 12px;
  color: var(--erp-steel);
  font-variant-numeric: tabular-nums;
}
</style>