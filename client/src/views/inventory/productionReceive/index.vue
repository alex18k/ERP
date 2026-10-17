<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, orderNo: '', onlyReceivable: 'true' })

const dialogVisible = ref(false)
const submitting = ref(false)
const current = ref<any>(null)
const form = reactive<any>({ quantity: 0, unit: '', warehouseId: null, binId: null, batchNo: '' })

const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const binRequired = computed(() => selectedWarehouse.value?.binManaged === true)

async function loadBins() {
  form.binId = null
  bins.value = []
  const wh = selectedWarehouse.value
  if (!wh?.binManaged) return
  const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
  bins.value = res.data.items
}

// 入库计量单位（产品基本单位 + 转换单位）与换算提示
const productMaterial = computed(() => current.value?.productionOrder?.material || null)
const unitOptions = computed<string[]>(() => {
  const m = productMaterial.value
  const set = new Set<string>()
  if (m?.units) for (const u of m.units) set.add(u)
  if (form.unit) set.add(form.unit)
  return [...set]
})
const unitRate = computed(() => {
  const m = productMaterial.value
  if (!m?.unit || !form.unit || form.unit === m.unit) return 1
  return m.unitRates?.[form.unit] || 0
})
const baseHint = computed(() => {
  const m = productMaterial.value
  if (!m?.unit || !form.unit || form.unit === m.unit) return ''
  if (!unitRate.value) return ''
  return `= ${Number(((Number(form.quantity) || 0) * unitRate.value).toFixed(6))} ${m.unit}`
})

function remaining(row: any) {
  return (row.quantity ?? 0) - (row.receivedQty ?? 0)
}

function statusLabel(s: string) {
  return ({ planned: '已计划', in_progress: '生产中', completed: '已完成', cancelled: '已取消' } as any)[s] || s
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.receivableBatches(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

function openDialog(row: any) {
  current.value = row
  form.quantity = remaining(row)
  form.unit = row.productionOrder?.material?.unit || ''
  form.batchNo = row.batchNo != null ? String(row.batchNo) : ''
  form.warehouseId = warehouseIdByLocation(warehouses.value, row.productionOrder?.material?.location) || warehouses.value[0]?.id || null
  dialogVisible.value = true
  loadBins()
}

async function submit() {
  if (!form.quantity || form.quantity <= 0) {
    ElMessage.warning('入库数量必须大于0')
    return
  }
  if (!form.warehouseId) {
    ElMessage.warning('请选择入库仓库')
    return
  }
  if (!unitRate.value) {
    ElMessage.warning(`单位「${form.unit}」未维护换算关系`)
    return
  }
  if (binRequired.value && !form.binId) {
    ElMessage.warning('该仓库启用货位管理，请选择货位')
    return
  }
  const baseQty = (Number(form.quantity) || 0) * unitRate.value
  if (baseQty > remaining(current.value) + 1e-6) {
    ElMessage.warning(`入库数量超过剩余可入库数量 ${remaining(current.value)}`)
    return
  }
  submitting.value = true
  try {
    await productionApi.receiveBatch(current.value.id, { quantity: form.quantity, unit: form.unit || undefined, warehouseId: form.warehouseId, binId: binRequired.value ? form.binId : undefined, batchNo: form.batchNo || undefined })
    ElMessage.success('生产入库成功')
    dialogVisible.value = false
    loadData()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
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
      <div class="table-toolbar">
        <span class="toolbar-title">生产入库（成品/半成品）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 180px" />
        <el-select v-model="query.onlyReceivable" placeholder="范围" style="width: 140px">
          <el-option label="仅未入库完" value="true" />
          <el-option label="全部" value="false" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', onlyReceivable: 'true', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="生产订单" width="150">
          <template #default="{ row }">{{ row.productionOrder?.orderNo }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.productionOrder?.material?.code }} - {{ row.productionOrder?.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="批次" width="80">
          <template #default="{ row }">第{{ row.batchNo }}批</template>
        </el-table-column>
        <el-table-column prop="quantity" label="批次数量" width="100" />
        <el-table-column prop="receivedQty" label="已入库" width="90" />
        <el-table-column label="剩余" width="90">
          <template #default="{ row }">{{ remaining(row) }}</template>
        </el-table-column>
        <el-table-column label="批次状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="remaining(row) > 0" size="small" type="primary" link @click="openDialog(row)">入库</el-button>
            <span v-else style="color: var(--el-text-color-secondary)">-</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="生产入库" width="480px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="生产订单">
          <span>{{ current?.productionOrder?.orderNo }}</span>
        </el-form-item>
        <el-form-item label="产品">
          <span>{{ current?.productionOrder?.material?.code }} - {{ current?.productionOrder?.material?.name }}</span>
        </el-form-item>
        <el-form-item label="批次 / 剩余">
          <span>第{{ current?.batchNo }}批 / {{ current ? remaining(current) : 0 }}</span>
        </el-form-item>
        <el-form-item label="入库仓库" required>
          <el-select v-model="form.warehouseId" placeholder="选择仓库" style="width: 100%" @change="loadBins">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="binRequired" label="货位" required>
          <el-select v-model="form.binId" filterable clearable placeholder="选择货位" style="width: 100%">
            <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="入库数量" required>
          <el-input-number v-model="form.quantity" :min="0" :precision="2" :controls="false" style="width: 100%" />
          <div v-if="baseHint" class="unit-hint">{{ baseHint }}</div>
        </el-form-item>
        <el-form-item label="计量单位">
          <el-select v-model="form.unit" filterable allow-create default-first-option placeholder="默认基本单位" style="width: 100%">
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="批号">
          <el-input v-model="form.batchNo" placeholder="空则自动生成；批号管理物料建议填生产批次号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确认入库</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.unit-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
