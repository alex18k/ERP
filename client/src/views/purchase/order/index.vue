<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { purchaseApi, supplierApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const router = useRouter()
const query = reactive({ page: 1, pageSize: 20, orderNo: '', supplierId: '', status: '', materialKeyword: '' })

const statusOptions = [
  { label: '草稿', value: 'draft', type: 'info' },
  { label: '已确认', value: 'confirmed', type: 'primary' },
]
// 历史数据兼容：旧的主表状态仅用于展示，不再参与任何逻辑
const legacyStatusMap: Record<string, { label: string; type: string }> = {
  partial_received: { label: '部分收货', type: 'warning' },
  received: { label: '已收货', type: 'success' },
  cancelled: { label: '已取消', type: 'danger' },
  closed: { label: '已关闭', type: 'info' },
}

const suppliers = ref<any[]>([])

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function statusLabel(s: string) {
  return statusOptions.find(o => o.value === s)?.label || legacyStatusMap[s]?.label || s
}
function statusType(s: string) {
  return statusOptions.find(o => o.value === s)?.type || legacyStatusMap[s]?.type || 'info'
}

// 平铺明细行：每行 = 一个采购明细；有物料关键词时只保留匹配的明细行
const rows = computed(() => {
  const keyword = (query.materialKeyword || '').trim()
  const out: any[] = []
  for (const o of list.value) {
    for (const it of (o.items || [])) {
      const m = it.material
      if (keyword && m) {
        const hit = [m.code, m.name, m.specification].some((v) => v && String(v).toLowerCase().includes(keyword.toLowerCase()))
        if (!hit) continue
      }
      out.push({
        orderId: o.id,
        orderNo: o.orderNo,
        supplierName: o.supplier?.name || '未指定',
        settleMethod: o.settleMethod,
        buyer: o.buyer,
        status: o.status,
        orderDate: o.orderDate,
        materialCode: m?.code,
        materialName: m?.name,
        specification: m?.specification,
        quantity: it.quantity,
        receivedQty: it.receivedQty ?? 0,
        unitPrice: it.unitPrice,
        amount: it.amount,
        expectedDate: it.expectedDate,
        sourceOrderNo: it.sourceOrderNo,
      })
    }
  }
  return out
})

function editOrder(orderId: number) {
  router.push(`/purchase/maintain?id=${orderId}`)
}

function fmtPrice(v: any) {
  const n = Number(v)
  return n ? String(n) : ''
}

onMounted(async () => {
  loadData()
  try {
    const res: any = await supplierApi.list({ pageSize: 200 })
    suppliers.value = res.data.items
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 150px" />
        <el-select v-model="query.supplierId" placeholder="供应商" clearable filterable style="width: 180px">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 200px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', supplierId: '', status: '', materialKeyword: '', page: 1 }), loadData()">重置</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="router.push('/purchase/maintain')"><el-icon><Plus /></el-icon>新增采购单</el-button>
      </div>

      <div class="table-toolbar">
        <el-button @click="purchaseApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="采购单号" width="150" />
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column prop="buyer" label="采购员" width="100" />
        <el-table-column label="订货日期" width="110">
          <template #default="{ row }">{{ row.orderDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="settleMethod" label="结算方式" width="100" />
        <el-table-column prop="materialCode" label="物料编码" width="110" />
        <el-table-column prop="materialName" label="物料名称" min-width="150" />
        <el-table-column prop="specification" label="型号规格" min-width="140" />
        <el-table-column prop="quantity" label="数量" width="90" />
        <el-table-column prop="receivedQty" label="已收" width="80" />
        <el-table-column label="单价" width="80">
          <template #default="{ row }">{{ fmtPrice(row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ (row.amount ?? (row.quantity * (row.unitPrice || 0))).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110">
          <template #default="{ row }">{{ row.expectedDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="sourceOrderNo" label="订单号" width="140" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="editOrder(row.orderId)">编辑</el-button>
            <el-button size="small" type="primary" link @click="router.push(`/purchase/print?id=${row.orderId}`)">打印</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

  </div>
</template>