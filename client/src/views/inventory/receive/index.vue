<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, warehouseApi, warehouseBinApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

const warehouses = ref<any[]>([])
const receiveVisible = ref(false)
const receiving = ref(false)
const currentOrder = ref<any>(null)
const receiveItems = ref<any[]>([])
const receiveForm = reactive({ effectiveDate: '', deliveryNo: '', keeper: '', remark: '' })
const keeperOptions = ref<string[]>([])
const binMap: Record<number, any[]> = {}

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))

function warehouseBinManaged(warehouseId: number | null) {
  return !!warehouseId && warehouses.value.find((w: any) => w.id === warehouseId)?.binManaged === true
}

function binOptionsFor(warehouseId: number | null) {
  return warehouseId ? binMap[warehouseId] || [] : []
}

async function loadKeeperOptions() {
  try {
    const res: any = await purchaseApi.receiptKeepers()
    keeperOptions.value = res.data || []
  } catch { /* ignore */ }
}

async function onLineWarehouseChange(row: any) {
  row.binId = null
  const wh = row.warehouseId
  if (!wh || !warehouseBinManaged(wh)) return
  if (!binMap[wh]) {
    const res: any = await warehouseBinApi.list({ warehouseId: wh, status: 1, pageSize: 200 })
    binMap[wh] = res.data.items
  }
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 平铺明细行：每行 = 一个采购明细
const NON_RECEIVABLE = ['cancelled', 'closed']

// 明细状态：空白状态计入收货/MRP，进度由 receivedQty 推断
function itemState(it: any) {
  if (it.status === 'cancelled') return { key: 'cancelled', label: '已取消', type: 'info' }
  if (it.status === 'closed') return { key: 'closed', label: '已关闭', type: 'info' }
  const remaining = it.quantity - (it.receivedQty ?? 0)
  if (remaining <= 0) return { key: 'received', label: '已收货', type: 'success' }
  if ((it.receivedQty ?? 0) > 0) return { key: 'partial_received', label: '部分收货', type: 'warning' }
  return { key: 'pending', label: '待收货', type: 'success' }
}

const rows = computed(() => {
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      const remaining = it.quantity - (it.receivedQty ?? 0)
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        status: o.status,
        itemState: itemState(it),
        receivable: !NON_RECEIVABLE.includes(it.status) && remaining > 0,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        remaining,
        unitPrice: it.unitPrice,
      })
    }
  }
  return out
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list({ ...query, receivable: true })
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function statusLabel(s: string) {
  return { confirmed: '已确认', partial_received: '部分收货', received: '已收货', draft: '草稿', cancelled: '已取消', closed: '已关闭' }[s] || s
}
function statusType(s: string) {
  return { confirmed: 'primary', partial_received: 'warning', received: 'success', draft: 'info', cancelled: 'danger', closed: 'info' }[s] || 'primary'
}

function openReceiveByOrder(orderId: number) {
  const order = list.value.find((o) => o.id === orderId)
  if (order) openReceive(order)
}

async function openReceive(row: any) {
  currentOrder.value = row
  receiveItems.value = (row.items || [])
    .filter((it: any) => !NON_RECEIVABLE.includes(it.status) && (it.quantity - (it.receivedQty ?? 0)) > 0)
    .map((it: any) => {
      const location = it.location || it.material?.location || ''
      return {
        itemId: it.id,
        status: it.status,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        unit: it.unit || it.material?.unit,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        remaining: it.quantity - (it.receivedQty ?? 0),
        location,
        warehouseId: warehouseIdByLocation(activeWarehouses.value, location),
        binId: null,
        receiveQty: 0,
        batchNo: '',
      }
    })
  receiveForm.effectiveDate = todayStr()
  receiveForm.deliveryNo = ''
  receiveForm.keeper = ''
  receiveForm.remark = ''
  receiveVisible.value = true
  await Promise.all([
    ...receiveItems.value.map((l) => onLineWarehouseChange(l)),
    loadKeeperOptions(),
  ])
}

const hasReceiveQty = computed(() => receiveItems.value.some((it) => (it.receiveQty || 0) > 0))

function toggleFillQty() {
  if (hasReceiveQty.value) {
    receiveItems.value.forEach((it) => {
      it.receiveQty = 0
    })
  } else {
    receiveItems.value.forEach((it) => {
      it.receiveQty = it.remaining
    })
  }
}

async function submitReceive(): Promise<boolean> {
  const lines = receiveItems.value.filter((it) => it.receiveQty > 0)
  if (lines.length === 0) {
    ElMessage.warning('请填写收货数量')
    return false
  }
  const over = lines.find((it) => it.receiveQty > it.remaining)
  if (over) {
    ElMessage.warning(`${over.materialCode} 收货数量不能超过未收数量 ${over.remaining}`)
    return false
  }
  for (const it of lines) {
    if (!it.warehouseId) {
      ElMessage.warning(`${it.materialCode} 请选择库位`)
      return false
    }
    if (warehouseBinManaged(it.warehouseId) && !it.binId) {
      ElMessage.warning(`${it.materialCode} 所在仓库启用货位管理，请选择货位`)
      return false
    }
  }
  const items = lines.map((it) => ({
    itemId: it.itemId,
    quantity: it.receiveQty,
    batchNo: it.batchNo || undefined,
    warehouseId: it.warehouseId,
    binId: it.binId || undefined,
  }))
  receiving.value = true
  try {
    const res: any = await purchaseApi.receive(currentOrder.value.id, {
      items,
      effectiveDate: receiveForm.effectiveDate || undefined,
      deliveryNo: receiveForm.deliveryNo || undefined,
      keeper: receiveForm.keeper || undefined,
      remark: receiveForm.remark || undefined,
    })
    const receiptNo = res.data?.receiptNo
    ElMessage.success(receiptNo ? `收货完成，收货单号 ${receiptNo}` : '收货完成')
    loadData()
    return true
  } catch {
    /* error shown */
    return false
  } finally {
    receiving.value = false
  }
}

async function confirmReceive() {
  const items = receiveItems.value.filter((it) => (it.receiveQty || 0) > 0)
  if (items.length === 0) {
    ElMessage.warning('请填写收货数量')
    return
  }
  const totalQty = items.reduce((sum, it) => sum + (it.receiveQty || 0), 0)
  try {
    await ElMessageBox.confirm(
      `本次将提交 ${items.length} 个物料收货，合计数量 ${totalQty}，提交后库存将增加且不可撤销，是否继续？`,
      '提交收货',
      { type: 'warning', confirmButtonText: '提交', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (await submitReceive()) receiveVisible.value = false
}

// 离开前检查是否有未保存的收货数量：有则询问是否保存
function confirmLeave(done?: () => void) {
  const close = () => {
    if (done) done()
    else receiveVisible.value = false
  }
  const hasQty = receiveItems.value.some((it) => (it.receiveQty || 0) > 0)
  if (!hasQty) {
    close()
    return
  }
  ElMessageBox.confirm('当前已填写收货数量，是否保存后关闭？', '未保存的收货', {
    confirmButtonText: '保存',
    cancelButtonText: '不保存',
    distinguishCancelAndClose: true,
    type: 'warning',
  })
    .then(async () => {
      if (await submitReceive()) close()
    })
    .catch((action: string) => {
      if (action === 'cancel') close()
    })
}

function handleReceive() {
  if (!currentRow.value?.receivable) return
  openReceiveByOrder(currentRow.value.orderId)
}

onMounted(async () => {
  const wRes: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = wRes.data.items
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 180px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadData()">重置</el-button>
        <div style="flex: 1" />
        <el-button type="success" plain :disabled="!currentRow?.receivable" @click="handleReceive"><el-icon><Box /></el-icon>收货</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 260px)" highlight-current-row @current-change="(row: any) => (currentRow = row)">
        <el-table-column prop="orderNo" label="采购单号" width="150" />
        <el-table-column prop="supplierName" label="供应商" min-width="200" />
        <el-table-column prop="materialCode" label="物料编码" width="120" show-overflow-tooltip />
        <el-table-column prop="materialName" label="物料名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="specification" label="规格型号" min-width="150" show-overflow-tooltip />
        <el-table-column prop="quantity" label="采购数量" width="90" />
        <el-table-column prop="receivedQty" label="已收" width="80" />
        <el-table-column prop="remaining" label="未收" width="80" />
        <el-table-column prop="unitPrice" label="单价" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="明细状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.itemState.type" size="small">{{ row.itemState.label }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </div>

    <!-- 收货弹窗 -->
    <el-dialog v-model="receiveVisible" :title="`采购收货 - ${currentOrder?.orderNo || ''}`" width="1200px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false" :before-close="confirmLeave">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="供应商">{{ currentOrder?.supplier?.name || '未指定' }}</el-descriptions-item>
        <el-descriptions-item label="生效日期">
          <el-date-picker v-model="receiveForm.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
        </el-descriptions-item>
        <el-descriptions-item label="送货单号">
          <el-input v-model="receiveForm.deliveryNo" clearable placeholder="供应商送货单号" size="small" style="width: 160px" />
        </el-descriptions-item>
        <el-descriptions-item label="仓管员">
          <el-select v-model="receiveForm.keeper" filterable clearable allow-create default-first-option placeholder="选择或输入仓管员" size="small" style="width: 160px">
            <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="备注">
          <el-input v-model="receiveForm.remark" clearable placeholder="备注" size="small" style="width: 220px" />
        </el-descriptions-item>
      </el-descriptions>
      <div style="display: flex; justify-content: flex-end; margin-bottom: 8px">
        <el-button size="small" @click="toggleFillQty">{{ hasReceiveQty ? '清空' : '自动' }}</el-button>
      </div>
      <el-table :data="receiveItems" size="small" stripe max-height="356px">
        <el-table-column label="物料编码" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.materialCode }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.materialName }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.specification || '-' }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="60" />
        <el-table-column prop="quantity" label="采购数量" width="80" />
        <el-table-column prop="receivedQty" label="已收" width="70" />
        <el-table-column prop="remaining" label="未收" width="70" />
        <el-table-column label="本次收货" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.receiveQty" :min="0" :max="row.remaining" :precision="2" :controls="false" size="small" style="width: 100%" @dblclick="row.receiveQty = row.remaining" />
          </template>
        </el-table-column>
        <el-table-column label="库位" width="140">
          <template #default="{ row }">
            <el-select v-model="row.warehouseId" size="small" filterable placeholder="选择库位" style="width: 100%" @change="onLineWarehouseChange(row)">
              <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="货位" width="120">
          <template #default="{ row }">
            <el-select v-if="warehouseBinManaged(row.warehouseId)" v-model="row.binId" size="small" filterable clearable placeholder="选择货位" style="width: 100%">
              <el-option v-for="b in binOptionsFor(row.warehouseId)" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
            </el-select>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="120">
          <template #default="{ row }">
            <el-input v-model="row.batchNo" placeholder="空则自动生成" size="small" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="confirmLeave()">关闭</el-button>
        <el-button type="primary" :loading="receiving" @click="confirmReceive">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>
