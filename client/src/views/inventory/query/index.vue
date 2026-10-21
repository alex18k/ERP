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
    const res: any = await stockApi.detail(query)
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
        <el-input v-model="query.materialCode" placeholder="物料编码" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialName" placeholder="物料名称/型号规格" clearable style="width: 170px" @keyup.enter="query.page = 1, loadData()" />
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
        <span class="toolbar-title">库存明细台账</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="stockApi.exportCsv(query)"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <div class="list-summary">
        <span>库存明细 <b>{{ total }}</b> 条</span>
        <span v-if="list.length">· 本页 <b>{{ list.length }}</b> 行</span>
        <span class="list-summary-tip">按「物料×仓库×货位×批号」平铺，仅统计库存数量>0 的记录</span>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
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
        <el-table-column label="货位" width="130">
          <template #default="{ row }">{{ row.bin ? `${row.bin.code} - ${row.bin.name}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="170">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="批内数量" width="100" align="right">
          <template #default="{ row }">{{ row.batchQty ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="reservedQty" label="预占量" width="90" align="right" />
        <el-table-column label="可用量" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'txt-danger': row.isLow }">{{ row.availableQty }}</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有匹配的库存记录" :image-size="56">
            <div class="empty-tip">仅显示库存数量大于 0 的批号行/未分批余量行，可放宽物料或仓库筛选后重试</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>