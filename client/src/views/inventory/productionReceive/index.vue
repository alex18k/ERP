<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { productionApi } from '../../../api'

const router = useRouter()

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

function remaining(row: any) {
  return (row.plannedQty ?? 0) - (row.receivedQty ?? 0)
}

// 状态：与生产领料页一致，显示所属生产订单的状态
const statusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '已下达', value: 'in_progress', type: 'warning' },
  { label: '已关闭', value: 'closed', type: 'info' },
]

function statusLabel(s: any) {
  return statusOptions.find((o) => o.value === s)?.label || s || '-'
}

function statusType(s: any) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

const execStatusOptions = [
  { label: '未排产', value: 'none', type: 'info' },
  { label: '待开工', value: 'pending', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已完成', value: 'completed', type: 'success' },
]

function execStatusLabel(s: any) {
  return execStatusOptions.find((o) => o.value === s)?.label || s || '-'
}

function execStatusType(s: any) {
  return execStatusOptions.find((o) => o.value === s)?.type || 'info'
}

// 发料状态：与生产发料页同口径（按领料明细 已发/未发 汇总，取消未发计入已结清）
const issueProgressOptions: Record<string, { label: string; type: string }> = {
  none: { label: '未领料', type: 'info' },
  partial: { label: '部分领料', type: 'warning' },
  issued: { label: '已发料', type: 'success' },
  cancelled: { label: '已取消未发', type: 'info' },
}
function issueProgress(row: any): string | null {
  const ms = row.materials || []
  if (ms.length === 0) return null
  const eps = 1e-6
  const remain = (m: any) => Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))
  if (ms.every((m: any) => remain(m) <= eps)) {
    return ms.every((m: any) => (m.issuedQty ?? 0) <= eps) ? 'cancelled' : 'issued'
  }
  if (ms.some((m: any) => (m.issuedQty ?? 0) > eps) || ms.some((m: any) => (m.cancelledQty ?? 0) > eps)) return 'partial'
  return 'none'
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.receivableOrders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

// 入库/退库改为独立录入页（同生产发料 issue-make 模式）
function openReceive(row: any) {
  router.push(`/inventory/production-receive-make?orderId=${row.id}`)
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产入库（成品/半成品）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 170px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="list-summary">
        <span>可入库生产订单 <b>{{ total }}</b> 张</span>
        <span v-if="list.length">· 本页剩余待入库 <b>{{ list.reduce((s: number, r: any) => s + Math.max(0, remaining(r)), 0) }}</b></span>
        <span class="list-summary-tip">显示所有未关闭的生产订单（含已入满）；成品/半成品按生产订单入库</span>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 300px)">
        <el-table-column label="生产订单" width="150">
          <template #default="{ row }">{{ row.orderNo }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="plannedQty" label="计划数量" width="100" align="right" />
        <el-table-column prop="receivedQty" label="已入库" width="90" align="right" />
        <el-table-column label="剩余" width="90" align="right">
          <template #default="{ row }">{{ remaining(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="执行状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" round :type="execStatusType(row.execStatus)">{{ execStatusLabel(row.execStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发料状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="issueProgress(row)" size="small" :type="issueProgressOptions[issueProgress(row)!].type">
              {{ issueProgressOptions[issueProgress(row)!].label }}
            </el-tag>
            <span v-else style="color: var(--el-text-color-secondary)">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openReceive(row)">入库</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有可入库的生产订单" :image-size="56">
            <div class="empty-tip">没有未关闭的生产订单；可清空订单号重试</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
