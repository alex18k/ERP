<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { purchaseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', materialKeyword: '', startDate: '', endDate: '' })

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

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 160px" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 200px" />
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', materialKeyword: '', startDate: '', endDate: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="收货日期" width="120">
          <template #default="{ row }">{{ dateOnly(row.effectiveDate || row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="documentNo" label="采购单号" width="160" />
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
