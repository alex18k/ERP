<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderApi, warehouseApi, warehouseBinApi, stockApi, systemApi } from '../../../api'
import { useAuthStore } from '../../../stores/auth'
import { warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const departments = ref<any[]>([])
const handlerOptions = ref<string[]>([])
const keeperOptions = ref<string[]>([])
const binMap = reactive<Record<number, any[]>>({})
const query = reactive({ page: 1, pageSize: 20, orderNo: '', customerName: '' })

const dialogVisible = ref(false)
const submitting = ref(false)
const currentOrder = ref<any>(null)
const authStore = useAuthStore()
const currentUserName = authStore.user?.realName || authStore.user?.username || ''
const form = reactive<any>({ effectiveDate: '', deliveryNo: '', handler: '', keeper: currentUserName, departmentId: null })
const detail = ref<any[]>([])

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function itemValues(row: any, key: string) {
  const vals = (row.items || []).map((it: any) => it.material?.[key]).filter(Boolean)
  return [...new Set(vals)].join('、') || '-'
}

function sellerNames(row: any) {
  return [row.seller1, row.seller2].filter(Boolean).join('、') || '-'
}

function statusLabel(s: string) {
  return ({ confirmed: '已确认', in_production: '生产中', completed: '已完工', shipped: '已发货' } as any)[s] || s
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await orderApi.shippable({ ...query })
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

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))

function warehouseBinManaged(warehouseId: number) {
  return warehouses.value.find((w: any) => w.id === warehouseId)?.binManaged === true
}
function binOptionsFor(warehouseId: number) {
  return binMap[warehouseId] || []
}
async function loadBatchOptions(row: any) {
  row.batchOptions = []
  if (!row.batchManaged || !row.materialId || !row.warehouseId) return
  const r: any = await stockApi.batches({ materialId: row.materialId, warehouseId: row.warehouseId, binId: row.binId || undefined, pageSize: 200 })
  row.batchOptions = (r.data.items || []).map((b: any) => b.batchNo)
}
async function onLineWarehouseChange(row: any) {
  row.binId = null
  row.batchNo = ''
  row.batchOptions = []
  const wh = row.warehouseId
  if (!wh) return
  if (warehouseBinManaged(wh) && !binMap[wh]) {
    const res: any = await warehouseBinApi.list({ warehouseId: wh, status: 1, pageSize: 200 })
    binMap[wh] = res.data.items
  }
  await loadBatchOptions(row)
}
async function onLineBinChange(row: any) {
  row.batchNo = ''
  await loadBatchOptions(row)
}

async function openDialog(row: any) {
  currentOrder.value = row
  form.effectiveDate = todayStr()
  form.deliveryNo = ''
  form.handler = ''
  form.keeper = currentUserName
  form.departmentId = null
  detail.value = (row.items || []).map((it: any) => ({
    itemId: it.id,
    materialId: it.materialId ?? it.material?.id,
    materialCode: it.material?.code,
    materialName: it.material?.name,
    specification: it.material?.specification,
    unit: it.unit || it.material?.unit,
    batchManaged: it.material?.batchManaged === true,
    quantity: it.quantity,
    deliveredQty: it.deliveredQty ?? 0,
    remaining: it.remaining ?? (it.quantity - (it.deliveredQty ?? 0)),
    location: it.material?.location || '',
    warehouseId: warehouseIdByLocation(activeWarehouses.value, it.material?.location) || null,
    binId: null,
    shipQty: 0,
    batchNo: '',
    batchOptions: [],
    remark: '',
  }))
  dialogVisible.value = true
  // 默认库位对应的仓库启用货位管理时，提前加载货位选项
  await Promise.all(detail.value.map((l) => onLineWarehouseChange(l)))
}

async function submit() {
  if (!form.effectiveDate) {
    ElMessage.warning('请选择发运日期')
    return
  }
  const items = detail.value
    .filter((l) => Number(l.shipQty) > 0)
    .map((l) => ({
      itemId: l.itemId,
      quantity: l.shipQty,
      warehouseId: l.warehouseId,
      binId: l.binId || undefined,
      batchNo: l.batchNo || undefined,
      remark: l.remark || undefined,
    }))
  if (items.length === 0) {
    ElMessage.warning('请填写发运数量')
    return
  }
  for (const l of items) {
    if (!l.warehouseId) {
      ElMessage.warning('请为每条发运明细选择出库仓库')
      return
    }
    if (warehouseBinManaged(l.warehouseId) && !l.binId) {
      ElMessage.warning('该仓库启用货位管理，请为发运明细选择货位')
      return
    }
  }
  for (const line of detail.value) {
    if (Number(line.shipQty) > Number(line.remaining) + 1e-6) {
      ElMessage.warning(`${line.materialCode} 发运数量不能超过未发数量 ${line.remaining}`)
      return
    }
    if (Number(line.shipQty) > 0 && line.batchManaged && !line.batchNo) {
      ElMessage.warning(`${line.materialCode} 为批号管理物料，请选择出库批号`)
      return
    }
  }
  const totalQty = items.reduce((sum, l) => sum + Number(l.quantity || 0), 0)
  try {
    await ElMessageBox.confirm(
      `本次将发运 ${items.length} 个物料，合计数量 ${totalQty}，提交后库存将减少且不可撤销，是否继续？`,
      '提交发运',
      { type: 'warning' },
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    await orderApi.shipping(currentOrder.value.id, {
      items,
      effectiveDate: form.effectiveDate || undefined,
      deliveryNo: form.deliveryNo || undefined,
      handler: form.handler || undefined,
      keeper: form.keeper || undefined,
      departmentId: form.departmentId || undefined,
    })
    ElMessage.success('发运完成')
    dialogVisible.value = false
    loadData()
  } catch {
    /* error shown by interceptor */
  } finally {
    submitting.value = false
  }
}

function fillAll() {
  for (const l of detail.value) {
    l.shipQty = l.remaining
    l.warehouseId = l.warehouseId || warehouseIdByLocation(activeWarehouses.value, l.location) || activeWarehouses.value[0]?.id || null
    onLineWarehouseChange(l)
  }
}

onMounted(async () => {
  await loadWarehouses()
  const [dRes, hRes, kRes]: any[] = await Promise.all([
    systemApi.departments(),
    stockApi.handlers(),
    stockApi.handlers('keeper'),
  ])
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  handlerOptions.value = hRes.data || []
  keeperOptions.value = [...new Set([currentUserName, ...(kRes.data || [])].filter(Boolean))]
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">销售发运（按销售订单出库）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="销售订单号" clearable style="width: 180px" />
        <el-input v-model="query.customerName" placeholder="客户名称" clearable style="width: 180px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', customerName: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="销售订单号" width="150" />
        <el-table-column prop="customerName" label="客户" min-width="160" />
        <el-table-column label="物料编码" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ itemValues(row, 'code') }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ itemValues(row, 'name') }}</template>
        </el-table-column>
        <el-table-column label="规格型号" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ itemValues(row, 'specification') }}</template>
        </el-table-column>
        <el-table-column label="销售员" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ sellerNames(row) }}</template>
        </el-table-column>
        <el-table-column prop="deliveryDate" label="交货日期" width="110">
          <template #default="{ row }">{{ row.deliveryDate ? String(row.deliveryDate).slice(0, 10) : '-' }}</template>
        </el-table-column>
        <el-table-column label="明细" width="70">
          <template #default="{ row }">{{ (row.items || []).length }}</template>
        </el-table-column>
        <el-table-column label="未发数量" width="100">
          <template #default="{ row }">{{ (row.items || []).reduce((s: number, it: any) => s + (it.remaining ?? 0), 0) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">发运</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="`销售发运 - ${currentOrder?.orderNo || ''}`" width="1200px" top="5vh" destroy-on-close>
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="客户">{{ currentOrder?.customerName }}</el-descriptions-item>
        <el-descriptions-item label="订单状态">{{ statusLabel(currentOrder?.status) }}</el-descriptions-item>
        <el-descriptions-item label="发运日期">
          <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
        </el-descriptions-item>
        <el-descriptions-item label="送货单号">
          <el-input v-model="form.deliveryNo" size="small" clearable placeholder="供应商/客户送货单号" style="width: 150px" />
        </el-descriptions-item>
        <el-descriptions-item label="经手人">
          <el-select v-model="form.handler" size="small" filterable clearable allow-create default-first-option placeholder="选择或输入" style="width: 150px">
            <el-option v-for="h in handlerOptions" :key="h" :label="h" :value="h" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="仓管员">
          <el-select v-model="form.keeper" size="small" filterable clearable allow-create default-first-option placeholder="选择或输入" style="width: 150px">
            <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="部门">
          <el-select v-model="form.departmentId" size="small" filterable clearable placeholder="选择部门" style="width: 150px">
            <el-option v-for="d in departments" :key="d.id" :label="`${d.code} - ${d.name}`" :value="d.id" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="操作">
          <el-button size="small" link type="primary" @click="fillAll">全部发运</el-button>
        </el-descriptions-item>
      </el-descriptions>

      <el-table :data="detail" size="small" stripe max-height="380">
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <div>{{ row.materialCode }} - {{ row.materialName }}</div>
            <span v-if="row.specification" style="color: var(--el-text-color-secondary); font-size: 12px">{{ row.specification }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="quantity" label="订单数量" width="90" />
        <el-table-column prop="deliveredQty" label="已发" width="80" />
        <el-table-column prop="remaining" label="未发" width="80" />
        <el-table-column label="本次发运" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.shipQty" :min="0" :max="row.remaining" :precision="2" size="small" :controls="false" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="出库仓库" width="170">
          <template #default="{ row }">
            <el-select v-model="row.warehouseId" size="small" placeholder="选择仓库" style="width: 100%" @change="onLineWarehouseChange(row)">
              <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="货位" width="150">
          <template #default="{ row }">
            <el-select v-if="warehouseBinManaged(row.warehouseId)" v-model="row.binId" size="small" filterable clearable placeholder="选择货位" style="width: 100%" @change="onLineBinChange(row)">
              <el-option v-for="b in binOptionsFor(row.warehouseId)" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
            </el-select>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="170">
          <template #default="{ row }">
            <el-select
              v-if="row.batchManaged"
              v-model="row.batchNo"
              size="small"
              filterable
              clearable
              placeholder="选择出库批号"
              style="width: 100%"
            >
              <el-option v-for="b in row.batchOptions" :key="b" :label="b" :value="b" />
            </el-select>
            <el-input v-else v-model="row.batchNo" size="small" placeholder="批号（可选）" />
          </template>
        </el-table-column>
        <el-table-column label="备注" width="130">
          <template #default="{ row }">
            <el-input v-model="row.remark" size="small" placeholder="备注" />
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.el-descriptions__label) {
  white-space: nowrap;
}
:deep(.el-dialog__body) {
  padding-top: 16px;
}
</style>
