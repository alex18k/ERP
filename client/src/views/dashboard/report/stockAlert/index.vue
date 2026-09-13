<script setup lang="ts">
import { ref } from 'vue'
import { stockApi } from '../../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const summary = ref({ critical: 0, warning: 0, total: 0 })

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.alert()
    list.value = res.data
    summary.value.total = res.data.length
    summary.value.critical = res.data.filter((i: any) => i.level === 'critical').length
    summary.value.warning = res.data.filter((i: any) => i.level === 'warning').length
  } finally { loading.value = false }
}

loadData()
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">库存预警</span>
        <div style="flex: 1" />
        <el-button type="primary" size="small" @click="loadData">刷新</el-button>
      </div>
    </div>

    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="8">
        <div class="stat-card red">
          <div class="stat-label">预警物料数</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ summary.total }}</div>
          <div class="stat-sub">低于安全库存的物料</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">告急</div>
          <div class="stat-value" style="color: var(--el-color-danger)">{{ summary.critical }}</div>
          <div class="stat-sub">现有量为 0</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card orange">
          <div class="stat-label">警告</div>
          <div class="stat-value" style="color: var(--erp-amber)">{{ summary.warning }}</div>
          <div class="stat-sub">低于安全库存但非零</div>
        </div>
      </el-col>
    </el-row>

    <div class="page-card">
      <el-table :data="list" size="small">
        <el-table-column prop="materialCode" label="物料编码" width="150" />
        <el-table-column prop="materialName" label="物料名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="预警级别" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.level === 'critical' ? 'danger' : 'warning'" size="small">
              {{ row.level === 'critical' ? '告急' : '警告' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="currentQty" label="现存量" width="100" align="center" />
        <el-table-column prop="safetyStock" label="安全库存" width="110" align="center" />
        <el-table-column prop="shortageQty" label="缺口数量" width="110" align="center">
          <template #default="{ row }">
            <span style="color: var(--el-color-danger)">{{ row.shortageQty }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length" description="所有物料库存均正常" :image-size="60" />
    </div>
  </div>
</template>