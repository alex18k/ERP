<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { stockApi, warehouseApi, stockTransactionTypeApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const warehouses = ref<any[]>([])
const transactionTypes = ref<any[]>([])
let materialOutTypeId: any = ''
const query = reactive({
  page: 1,
  pageSize: 20,
  materialKeyword: '',
  warehouseId: '',
  transactionTypeId: '',
  startDate: '',
  endDate: '',
  documentNo: '',
  direction: 'out',
})

function signedQty(row: any) {
  const q = Number(row.quantity) || 0
  const signed = row.type === 'out' ? -q : q
  return signed > 0 ? `+${signed}` : String(signed)
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.records({ ...query, transactionTypeId: query.transactionTypeId || materialOutTypeId })
    list.value = res.data.items
    total.value = res.data.total
    currentRow.value = null
  } finally {
    loading.value = false
  }
}

function goMaterialOut() {
  router.push('/inventory/material-out')
}

function printDocument(row: any) {
  if (!row?.documentNo) return
  router.push({ path: '/inventory/material-out-print', query: { documentNo: row.documentNo } })
}

function printSelected() {
  if (!currentRow.value) return
  printDocument(currentRow.value)
}

onMounted(async () => {
  const [wRes, tRes]: any[] = await Promise.all([
    warehouseApi.list({ pageSize: 200 }),
    stockTransactionTypeApi.list({ pageSize: 200 }),
  ])
  warehouses.value = wRes.data.items || []
  transactionTypes.value = (tRes.data.items || []).filter(
    (t: any) => t.status === 1 && t.direction === 'out' && (t.code === 'ISS-IC' || t.description === '材料出库'),
  )
  materialOutTypeId = transactionTypes.value[0]?.id || ''
  query.transactionTypeId = materialOutTypeId
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.documentNo" placeholder="事务单号/源单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-select v-model="query.transactionTypeId" placeholder="事务类型" clearable filterable style="width: 160px">
          <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description || t.code" :value="t.id" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', transactionTypeId: transactionTypes[0]?.id || '', startDate: '', endDate: '', documentNo: '', page: 1 }), loadData()">重置</el-button>
        <el-button type="primary" plain style="margin-left: auto" :disabled="!currentRow?.documentNo" @click="printSelected"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button type="success" plain class="btn-add" @click="goMaterialOut"><el-icon><Upload /></el-icon>材料出库</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="生效日期" width="100">
          <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="事务单号" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.documentNo" type="primary" :underline="false" @click.stop="printDocument(row)">{{ row.documentNo }}</el-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="源单号" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="行号" width="56" align="center">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="事务类型" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.transactionType?.description || '-' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="封装" width="80" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.packageType || '-' }}</template>
        </el-table-column>
        <el-table-column label="库位" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="batchNo" label="批号" width="130" show-overflow-tooltip />
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.um || row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="数量" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: Number(signedQty(row)) >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)', fontWeight: 600 }">
              {{ signedQty(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">{{ row.price != null ? Number(row.price).toFixed(6) : '-' }}</template>
        </el-table-column>
        <el-table-column label="部门" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="经手人" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.handler || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.createdAt }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的材料出库流水" :image-size="56">
            <div class="empty-tip">已限定「材料出库」类事务；可清空单号/物料/日期条件后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
