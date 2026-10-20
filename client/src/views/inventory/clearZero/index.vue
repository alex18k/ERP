<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockApi, warehouseApi } from '../../../api'

const loading = ref(false)
const clearing = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const counts = ref({ stockCount: 0, batchCount: 0 })
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialKeyword: '', warehouseId: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.zeroStock(query)
    list.value = res.data.items
    total.value = res.data.total
    counts.value = { stockCount: res.data.stockCount, batchCount: res.data.batchCount }
  } finally { loading.value = false }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

async function handleClear() {
  await loadData()
  if (total.value === 0) {
    ElMessage.info('当前没有 0 库存记录')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将清除现存量 0 记录 ${counts.value.stockCount} 条、批次库存 0 记录 ${counts.value.batchCount} 条，共 ${total.value} 条。库存事务流水不受影响，是否继续？`,
      '清除 0 库存',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消' }
    )
  } catch { return }
  clearing.value = true
  try {
    const res: any = await stockApi.clearZero(query)
    ElMessage.success(`已清除 0 库存记录 ${res.data.deletedStock + res.data.deletedBatch} 条`)
    query.page = 1
    await loadData()
  } finally { clearing.value = false }
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
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 160px" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 160px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">清除 0 库存</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button type="danger" :loading="clearing" :disabled="total === 0" @click="handleClear">
          <el-icon><Delete /></el-icon>清除 0 库存
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin: 8px 0 16px"
        title="出入库扣减至 0 后现存量/批次库存行会保留，此处可一次性清理；仅删除数量为 0 的库存行，库存事务流水（StockRecord）保持不变。"
      />

      <el-descriptions :column="3" border style="margin-bottom: 12px">
        <el-descriptions-item label="现存量 0 记录">{{ counts.stockCount }} 条</el-descriptions-item>
        <el-descriptions-item label="批次库存 0 记录">{{ counts.batchCount }} 条</el-descriptions-item>
        <el-descriptions-item label="合计">{{ total }} 条</el-descriptions-item>
      </el-descriptions>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 380px)">
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.type === 'stock' ? 'primary' : 'warning'" size="small" effect="plain">{{ row.typeLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="物料编码" width="120">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="150">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="150">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="120">
          <template #default="{ row }">{{ row.bin ? `${row.bin.code} - ${row.bin.name}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="数量" width="90" align="right" prop="quantity" />
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.material?.unit }}</template>
        </el-table-column>
        <el-table-column label="最近更新时间" width="170">
          <template #default="{ row }">{{ row.updatedAt?.slice(0, 19)?.replace('T', ' ') }}</template>
        </el-table-column>
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
