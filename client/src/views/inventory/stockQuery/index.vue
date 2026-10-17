<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { stockApi, warehouseApi, warehouseBinApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialCode: '', materialName: '', warehouseId: '', binId: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.summary(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

const selectedBinManaged = computed(() => warehouses.value.find((w: any) => w.id === query.warehouseId)?.binManaged ?? false)

async function onWarehouseChange() {
  query.binId = ''
  bins.value = []
  const wh = warehouses.value.find((w: any) => w.id === query.warehouseId)
  if (wh?.binManaged) {
    const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
    bins.value = res.data.items
  }
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
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 160px" @change="onWarehouseChange">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-select v-if="selectedBinManaged" v-model="query.binId" placeholder="货位" clearable style="width: 140px">
          <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialCode: '', materialName: '', warehouseId: '', binId: '', page: 1 }), bins = [], loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">库存查询（按仓库 × 物料，展开查看货位明细）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="stockApi.exportCsv(query)"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="list" v-loading="loading" row-key="key" :tree-props="{ children: 'children' }" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="物料编码 / 序号" width="150">
          <template #default="{ row }">
            <span v-if="row.material">{{ row.material.code }}</span>
            <span v-else class="detail-idx">{{ row.index }}</span>
          </template>
        </el-table-column>
        <el-table-column label="物料名称 / 货位" min-width="200">
          <template #default="{ row }">
            <span v-if="row.material">{{ row.material.name }}</span>
            <span v-else>{{ row.binLabel }}</span>
          </template>
        </el-table-column>
        <el-table-column label="型号规格 / 批号" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.material">{{ row.material.specification || '-' }}</span>
            <span v-else>{{ row.batchLabel }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类别" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.material" size="small" effect="plain">{{ materialCategoryLabel(row.material.category) }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="仓库" width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.material">{{ row.warehouse?.name }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="现存量" width="100" align="right">
          <template #default="{ row }">
            <span v-if="row.material" :class="{ 'text-low': row.isLow }" style="font-weight: 600">{{ row.quantity }}</span>
            <span v-else>{{ row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.material ? row.material.unit || '-' : '-' }}</template>
        </el-table-column>
        <el-table-column label="可用量" width="100" align="right">
          <template #default="{ row }">{{ row.availableQty }}</template>
        </el-table-column>
        <el-table-column label="安全库存" width="90" align="right">
          <template #default="{ row }">{{ row.material ? row.safetyStock ?? 0 : '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <template v-if="row.material">
              <el-tag v-if="row.isLow" type="danger" size="small">低于安全库存</el-tag>
              <el-tag v-else type="success" size="small">正常</el-tag>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-idx {
  display: inline-block;
  min-width: 20px;
  padding: 0 6px;
  color: var(--el-text-color-secondary);
}
</style>
