<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, warehouseApi, warehouseBinApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const receiveVisible = ref(false)
const receiving = ref(false)
const currentOrder = ref<any>(null)
const receiveItems = ref<any[]>([])
const receiveForm = reactive({ effectiveDate: '', location: '', binId: null as number | null })
const locationOptions = ref<{ code: string; name: string }[]>([])

const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.code === receiveForm.location) || null)
const binRequired = computed(() => selectedWarehouse.value?.binManaged === true)

async function loadBins() {
  receiveForm.binId = null
  bins.value = []
  const wh = selectedWarehouse.value
  if (!wh?.binManaged) return
  const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
  bins.value = res.data.items
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

function openReceive(row: any) {
  currentOrder.value = row
  receiveItems.value = (row.items || [])
    .filter((it: any) => !NON_RECEIVABLE.includes(it.status) && (it.quantity - (it.receivedQty ?? 0)) > 0)
    .map((it: any) => ({
      itemId: it.id,
      status: it.status,
      materialCode: it.material?.code,
      materialName: it.material?.name,
      unit: it.unit || it.material?.unit,
      quantity: it.quantity,
      receivedQty: it.receivedQty ?? 0,
      remaining: it.quantity - (it.receivedQty ?? 0),
      receiveQty: 0,
      batchNo: '',
    }))
  receiveForm.effectiveDate = todayStr()
  const activeCodes = new Set(warehouses.value.filter((w: any) => w.status === 1).map((w: any) => w.code))
  const locs = new Set<string>((row.items || []).map((it: any) => it.location || it.material?.location).filter((c: string) => c && activeCodes.has(c)))
  receiveForm.location = locs.size === 1 ? [...locs][0] : ''
  loadBins()
  receiveVisible.value = true
}

function autoFillQty() {
  receiveItems.value.forEach((it) => {
    it.receiveQty = it.remaining
  })
}

async function submitReceive(): Promise<boolean> {
  const items = receiveItems.value
    .filter((it) => it.receiveQty > 0)
    .map((it) => ({ itemId: it.itemId, quantity: it.receiveQty, batchNo: it.batchNo || undefined }))
  if (items.length === 0) {
    ElMessage.warning('请填写收货数量')
    return false
  }
  const over = receiveItems.value.find((it) => it.receiveQty > it.remaining)
  if (over) {
    ElMessage.warning(`${over.materialCode} 收货数量不能超过未收数量 ${over.remaining}`)
    return false
  }
  if (binRequired.value && !receiveForm.binId) {
    ElMessage.warning('该仓库启用货位管理，请选择货位')
    return false
  }
  receiving.value = true
  try {
    const res: any = await purchaseApi.receive(currentOrder.value.id, {
      items,
      effectiveDate: receiveForm.effectiveDate || undefined,
      location: receiveForm.location || undefined,
      binId: binRequired.value ? receiveForm.binId : undefined,
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

onMounted(async () => {
  const wRes: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = wRes.data.items
  locationOptions.value = warehouses.value.filter((w: any) => w.status === 1).map((w: any) => ({ code: w.code, name: w.name }))
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
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="采购单号" width="150" />
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <span>{{ row.materialCode }} - {{ row.materialName }}</span>
            <span v-if="row.specification" style="color: var(--el-text-color-secondary); margin-left: 6px">{{ row.specification }}</span>
          </template>
        </el-table-column>
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
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="success" link :disabled="!row.receivable" @click="openReceiveByOrder(row.orderId)">收货</el-button>
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
    <el-dialog v-model="receiveVisible" :title="`采购收货 - ${currentOrder?.orderNo || ''}`" width="960px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false" :before-close="confirmLeave">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="供应商">{{ currentOrder?.supplier?.name || '未指定' }}</el-descriptions-item>
        <el-descriptions-item label="生效日期">
          <el-date-picker v-model="receiveForm.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
        </el-descriptions-item>
        <el-descriptions-item label="库位">
          <el-select v-model="receiveForm.location" filterable clearable placeholder="选择库位" size="small" style="width: 160px" @change="loadBins">
            <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item v-if="binRequired" label="货位">
          <el-select v-model="receiveForm.binId" filterable clearable placeholder="选择货位" size="small" style="width: 160px">
            <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
          </el-select>
        </el-descriptions-item>
      </el-descriptions>
      <div style="display: flex; justify-content: flex-end; margin-bottom: 8px">
        <el-button size="small" @click="autoFillQty">自动</el-button>
      </div>
      <el-table :data="receiveItems" size="small" stripe max-height="356px">
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="quantity" label="采购数量" width="90" />
        <el-table-column prop="receivedQty" label="已收" width="80" />
        <el-table-column prop="remaining" label="未收" width="80" />
        <el-table-column label="本次收货" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.receiveQty" :min="0" :max="row.remaining" :precision="2" :controls="false" size="small" style="width: 100%" @dblclick="row.receiveQty = row.remaining" />
          </template>
        </el-table-column>
        <el-table-column label="批号" width="170">
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
