<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { orderApi, warehouseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, orderNo: '', customerName: '' })

const dialogVisible = ref(false)
const submitting = ref(false)
const currentOrder = ref<any>(null)
const form = reactive<any>({ effectiveDate: '' })
const detail = ref<any[]>([])

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

function openDialog(row: any) {
  currentOrder.value = row
  form.effectiveDate = todayStr()
  detail.value = (row.items || []).map((it: any) => ({
    itemId: it.id,
    materialCode: it.material?.code,
    materialName: it.material?.name,
    specification: it.material?.specification,
    unit: it.unit || it.material?.unit,
    quantity: it.quantity,
    deliveredQty: it.deliveredQty ?? 0,
    remaining: it.remaining ?? (it.quantity - (it.deliveredQty ?? 0)),
    location: it.material?.location || '',
    warehouseId: null,
    shipQty: 0,
    remark: '',
  }))
  dialogVisible.value = true
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
  }
  for (const line of detail.value) {
    if (Number(line.shipQty) > Number(line.remaining) + 1e-6) {
      ElMessage.warning(`${line.materialCode} 发运数量不能超过未发数量 ${line.remaining}`)
      return
    }
  }
  submitting.value = true
  try {
    await orderApi.shipping(currentOrder.value.id, {
      items,
      effectiveDate: form.effectiveDate || undefined,
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
    l.warehouseId = l.warehouseId || warehouses.value[0]?.id || null
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

    <el-dialog v-model="dialogVisible" :title="`销售发运 - ${currentOrder?.orderNo || ''}`" width="960px" top="6vh" destroy-on-close>
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="客户">{{ currentOrder?.customerName }}</el-descriptions-item>
        <el-descriptions-item label="订单状态">{{ statusLabel(currentOrder?.status) }}</el-descriptions-item>
        <el-descriptions-item label="发运日期">
          <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" size="small" style="width: 150px" />
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
            <el-select v-model="row.warehouseId" size="small" placeholder="选择仓库" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
            </el-select>
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
        <el-button type="primary" :loading="submitting" @click="submit">确认发运</el-button>
      </template>
    </el-dialog>
  </div>
</template>