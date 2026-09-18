<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { stockApi, materialApi } from '../../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const materialTypes = ref<string[]>([])
const query = reactive({ materialType: '', keyword: '' })

async function loadMaterialTypes() {
  try {
    const res: any = await materialApi.types()
    materialTypes.value = res.data || []
  } catch {
    materialTypes.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    const params: any = {}
    if (query.materialType) params.materialType = query.materialType
    if (query.keyword) params.keyword = query.keyword
    const res: any = await stockApi.alert(params)
    list.value = res.data
  } finally { loading.value = false }
}

function search() {
  loadData()
}

function resetQuery() {
  Object.assign(query, { materialType: '', keyword: '' })
  loadData()
}

onMounted(async () => {
  await loadMaterialTypes()
  await loadData()
})
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card" style="margin-bottom: 16px">
      <div class="search-bar">
        <span class="toolbar-title">库存预警</span>
        <el-select v-model="query.materialType" placeholder="物料类别" clearable filterable style="width: 170px">
          <el-option v-for="t in materialTypes" :key="t" :label="t" :value="t" />
        </el-select>
        <el-input v-model="query.keyword" placeholder="物料号/名称/规格型号" clearable style="width: 220px" @keyup.enter="search" />
        <el-button type="primary" @click="search"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
        <div style="flex: 1" />
        <el-button type="primary" size="small" @click="loadData">刷新</el-button>
      </div>
    </div>

    <div class="page-card">
      <el-table :data="list" size="small">
        <el-table-column prop="materialCode" label="物料编码" width="150" />
        <el-table-column prop="materialName" label="物料名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="specification" label="规格型号" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.specification || '-' }}</template>
        </el-table-column>
        <el-table-column prop="materialType" label="物料类别" width="140">
          <template #default="{ row }">{{ row.materialType || '-' }}</template>
        </el-table-column>
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