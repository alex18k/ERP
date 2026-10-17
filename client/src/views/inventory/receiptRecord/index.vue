<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { purchaseApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const query = reactive({ page: 1, pageSize: 20, receiptNo: '', orderNo: '', materialKeyword: '', startDate: '', endDate: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.receipts(query)
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
  const receiptNo = currentRow.value?.receiptNo || currentRow.value?.documentNo
  if (!receiptNo) return
  router.push(`/purchase/receipt-print?receiptNo=${encodeURIComponent(receiptNo)}`)
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.receiptNo" placeholder="收货单号" clearable style="width: 170px" />
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 160px" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 200px" />
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { receiptNo: '', orderNo: '', materialKeyword: '', startDate: '', endDate: '', page: 1 }), loadData()">重置</el-button>
        <div style="flex: 1" />
        <el-button type="primary" plain :disabled="!currentRow?.receiptNo && !currentRow?.documentNo" @click="handlePrint"><el-icon><Printer /></el-icon>打印收货单</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="收货日期" width="120">
          <template #default="{ row }">{{ dateOnly(row.effectiveDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="收货单号" width="160">
          <template #default="{ row }">{{ row.receiptNo || row.documentNo }}</template>
        </el-table-column>
        <el-table-column prop="orderNo" label="采购单号" width="160">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="supplierName" label="供应商" min-width="140">
          <template #default="{ row }">{{ row.supplierName || '未指定' }}</template>
        </el-table-column>
        <el-table-column prop="lineNo" label="行号" width="70">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <span>{{ row.material?.code }} - {{ row.material?.name }}</span>
            <span v-if="row.material?.specification" style="color: var(--el-text-color-secondary); margin-left: 6px">{{ row.material.specification }}</span>
          </template>
        </el-table-column>
        <el-table-column label="收货数量" width="100">
          <template #default="{ row }">
            <span style="color: var(--el-color-success); font-weight: 600">+{{ row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" min-width="160">
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="120">
          <template #default="{ row }">{{ row.warehouse?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="location" label="库位" width="90">
          <template #default="{ row }">{{ row.location || '-' }}</template>
        </el-table-column>
        <el-table-column label="货位" width="120">
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="100">
          <template #default="{ row }">{{ row.operator?.realName || row.operator?.username || '-' }}</template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
