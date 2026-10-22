<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { stockApi, warehouseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialKeyword: '', warehouseId: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.batches(query)
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
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 160px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">批号库存台账</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="物料编码" width="120">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="150">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="170" prop="batchNo" />
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="基本单位" width="80">
          <template #default="{ row }">{{ row.material?.unit }}</template>
        </el-table-column>
        <el-table-column label="现存量" width="100" prop="quantity" align="right" />
        <el-table-column label="最近更新时间" width="170">
          <template #default="{ row }">{{ row.updatedAt?.slice(0, 19)?.replace('T', ' ') }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有符合条件的批号库存" :image-size="56">
            <div class="empty-tip">仅显示仍有结存的批次；可清空物料关键词/仓库后重试</div>
          </el-empty>
        </template>
</el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadData"
        @size-change="loadData"
      />
    </div>
  </div>
</template>
