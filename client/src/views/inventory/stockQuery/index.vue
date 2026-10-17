<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { stockApi, warehouseApi, warehouseBinApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const query = reactive({ materialCode: '', materialName: '', warehouseId: '', binId: '' })

// 按「仓库 × 物料」汇总为父行，展开显示各货位明细
const groups = computed(() => {
  const map = new Map<string, any>()
  for (const s of list.value) {
    const key = `${s.warehouseId}|${s.materialId}`
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        material: s.material,
        warehouse: s.warehouse,
        quantity: 0,
        availableQty: 0,
        reservedQty: 0,
        safetyStock: s.material?.safetyStock ?? 0,
        children: [] as any[],
      }
      map.set(key, g)
    }
    g.quantity += Number(s.quantity) || 0
    g.availableQty += Number(s.availableQty) || 0
    g.reservedQty += Number(s.reservedQty) || 0
    const batches: any[] = (s.batches || []).filter((b: any) => Number(b.quantity) > 0)
    g.children.push({
      index: 0,
      binLabel: s.bin ? `${s.bin.code} - ${s.bin.name}` : '未分配货位',
      batchLabel: batches.length ? batches.map((b: any) => `${b.batchNo}（${b.quantity}）`).join('，') : '-',
      hasDetail: !!s.bin || batches.length > 0,
      quantity: Number(s.quantity) || 0,
      availableQty: Number(s.availableQty) || 0,
    })
  }
  const arr = [...map.values()]
  for (const g of arr) {
    g.isLow = g.safetyStock > 0 && g.quantity <= g.safetyStock
    g.children.sort((a: any, b: any) => a.binLabel.localeCompare(b.binLabel))
    g.children.forEach((c: any, i: number) => (c.index = i + 1))
    // 既无货位也无批号的单一明细无需展开：去掉子行，不显示 > 符号
    if (!g.children.some((c: any) => c.hasDetail)) delete g.children
  }
  return arr.sort((a, b) => {
    const c = String(a.warehouse?.name || '').localeCompare(String(b.warehouse?.name || ''))
    return c !== 0 ? c : String(a.material?.code || '').localeCompare(String(b.material?.code || ''))
  })
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.list({ ...query, page: 1, pageSize: 100000 })
    list.value = res.data.items
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
        <el-button type="primary" @click="loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialCode: '', materialName: '', warehouseId: '', binId: '' }), bins = [], loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">库存查询（按仓库 × 物料，展开查看货位明细）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="stockApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="groups" v-loading="loading" row-key="key" :tree-props="{ children: 'children' }" stripe max-height="calc(100vh - 260px)">
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
