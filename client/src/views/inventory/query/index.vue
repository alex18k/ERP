<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { stockApi, warehouseApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialCode: '', materialName: '', warehouseId: '' })

const flatList = computed(() => {
  const rows: any[] = []
  for (const s of list.value) {
    const batches = s.batches || []
    if (batches.length === 0) {
      rows.push({ ...s, batchNo: '', batchQty: null })
    } else {
      for (const b of batches) rows.push({ ...s, batchNo: b.batchNo, batchQty: b.quantity })
    }
  }
  return rows
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

onMounted(async () => {
  await loadWarehouses()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.materialCode" placeholder="物料编码" clearable style="width: 150px" />
        <el-input v-model="query.materialName" placeholder="物料名称/型号规格" clearable style="width: 170px" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 160px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialCode: '', materialName: '', warehouseId: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">库存台账（按仓库×物料）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="stockApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="flatList" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="物料编码" width="110">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="150">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="140">
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="类别" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ materialCategoryLabel(row.material?.category) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="现存量" width="100">
          <template #default="{ row }">
            <span :class="{ 'text-low': row.isLow }" style="font-weight: 600">{{ row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="170">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="批内数量" width="100">
          <template #default="{ row }">{{ row.batchQty ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="reservedQty" label="预占量" width="90" />
        <el-table-column label="可用量" width="100">
          <template #default="{ row }">{{ row.availableQty }}</template>
        </el-table-column>
        <el-table-column label="安全库存" width="90">
          <template #default="{ row }">{{ row.material?.safetyStock ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.isLow" type="danger" size="small">低于安全库存</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>