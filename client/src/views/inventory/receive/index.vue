<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { purchaseApi } from '../../../api'
import { BASE_LOCATIONS } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

const receiveVisible = ref(false)
const receiving = ref(false)
const currentOrder = ref<any>(null)
const receiveItems = ref<any[]>([])
const receiveForm = reactive({ effectiveDate: '', location: '' })
const locationOptions = BASE_LOCATIONS

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 平铺明细行：每行 = 一个采购明细
const rows = computed(() => {
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        status: o.status,
        materialCode: it.material?.code,
        materialName: it.material?.name,
        specification: it.material?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        remaining: it.quantity - (it.receivedQty ?? 0),
        unitPrice: it.unitPrice,
      })
    }
  }
  return out
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list({ ...query, status: 'confirmed,partial_received' })
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function statusLabel(s: string) {
  return { confirmed: '已确认', partial_received: '部分收货' }[s] || s
}

function openReceiveByOrder(orderId: number) {
  const order = list.value.find((o) => o.id === orderId)
  if (order) openReceive(order)
}

function openReceive(row: any) {
  currentOrder.value = row
  receiveItems.value = (row.items || []).map((it: any) => ({
    itemId: it.id,
    materialCode: it.material?.code,
    materialName: it.material?.name,
    quantity: it.quantity,
    receivedQty: it.receivedQty ?? 0,
    remaining: it.quantity - (it.receivedQty ?? 0),
    receiveQty: it.quantity - (it.receivedQty ?? 0),
  }))
  receiveForm.effectiveDate = todayStr()
  const locs = new Set<string>((row.items || []).map((it: any) => it.material?.location).filter(Boolean))
  receiveForm.location = locs.size === 1 ? [...locs][0] : ''
  receiveVisible.value = true
}

async function submitReceive() {
  const items = receiveItems.value
    .filter((it) => it.receiveQty > 0)
    .map((it) => ({ itemId: it.itemId, quantity: it.receiveQty }))
  if (items.length === 0) {
    ElMessage.warning('请填写收货数量')
    return
  }
  const over = receiveItems.value.find((it) => it.receiveQty > it.remaining)
  if (over) {
    ElMessage.warning(`${over.materialCode} 收货数量不能超过未收数量 ${over.remaining}`)
    return
  }
  receiving.value = true
  try {
    await purchaseApi.receive(currentOrder.value.id, {
      items,
      effectiveDate: receiveForm.effectiveDate || undefined,
      location: receiveForm.location || undefined,
    })
    ElMessage.success('收货完成')
    receiveVisible.value = false
    loadData()
  } catch {
    /* error shown */
  } finally {
    receiving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 180px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-alert
        type="info" :closable="false" show-icon
        title="列出「已确认」和「部分收货」采购单的明细，可填写数量分批收货，收货后物料自动入库并生成入库记录。"
        style="margin-bottom: 16px"
      />

      <el-table :data="rows" v-loading="loading" stripe>
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
            <el-tag :type="row.status === 'partial_received' ? 'warning' : 'primary'" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="success" link @click="openReceiveByOrder(row.orderId)">收货</el-button>
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
    <el-dialog v-model="receiveVisible" :title="`采购收货 - ${currentOrder?.orderNo || ''}`" width="720px" destroy-on-close>
      <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="供应商">{{ currentOrder?.supplier?.name || '未指定' }}</el-descriptions-item>
        <el-descriptions-item label="生效日期">
          <el-date-picker v-model="receiveForm.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
        </el-descriptions-item>
        <el-descriptions-item label="库位">
          <el-select v-model="receiveForm.location" filterable allow-create default-first-option clearable placeholder="选择或输入库位" size="small" style="width: 160px">
            <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
          </el-select>
        </el-descriptions-item>
      </el-descriptions>
      <el-table :data="receiveItems" size="small" stripe>
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="采购数量" width="90" />
        <el-table-column prop="receivedQty" label="已收" width="80" />
        <el-table-column prop="remaining" label="未收" width="80" />
        <el-table-column label="本次收货" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.receiveQty" :min="0" :max="row.remaining" :precision="2" size="small" style="width: 100%" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="receiveVisible = false">取消</el-button>
        <el-button type="primary" :loading="receiving" @click="submitReceive">确认收货</el-button>
      </template>
    </el-dialog>
  </div>
</template>
