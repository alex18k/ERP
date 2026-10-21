<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { orderApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const query = reactive({ page: 1, pageSize: 20, documentNo: '', orderNo: '', customerName: '', materialKeyword: '', startDate: '', endDate: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await orderApi.shipments(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function dateOnly(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : '-'
}

function handlePrint() {
  const documentNo = currentRow.value?.documentNo
  if (!documentNo) return
  router.push(`/inventory/shipment-print?documentNo=${encodeURIComponent(documentNo)}`)
}

function resetQuery() {
  Object.assign(query, { documentNo: '', orderNo: '', customerName: '', materialKeyword: '', startDate: '', endDate: '', page: 1 })
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.documentNo" placeholder="发货单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.orderNo" placeholder="销售订单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.customerName" placeholder="客户名称" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 190px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 140px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 140px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
        <div style="flex: 1" />
        <el-button type="primary" plain :disabled="!currentRow?.documentNo" @click="handlePrint"><el-icon><Printer /></el-icon>打印销售送货单</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="发货日期" width="100">
          <template #default="{ row }">{{ dateOnly(row.effectiveDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="发货单号" width="150">
          <template #default="{ row }">{{ row.documentNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="销售订单号" width="150">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.customerName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="lineNo" label="行号" width="70">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="规格型号" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column label="发货数量" width="110" align="right">
          <template #default="{ row }">
            <span style="color: var(--el-color-success); font-weight: 600">-{{ row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="销售员" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.sellerNames || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" width="140">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="货位" width="120">
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="100">
          <template #default="{ row }">{{ row.operator?.realName || row.operator?.username || '-' }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的发运记录" :image-size="56">
            <div class="empty-tip">可清空发货单号/订单号/客户/日期条件后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
