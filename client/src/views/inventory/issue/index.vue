<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { productionApi } from '../../../api'

const router = useRouter()

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', status: '' })

const statusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '已下达', value: 'in_progress', type: 'warning' },
  { label: '已关闭', value: 'closed', type: 'info' },
]

function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label || s
}

function statusType(s: string) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

// 发料进度标记：按领料明细 已发/未发 汇总（取消未发计入已结清，不影响领料按钮，超发由后端跳过拦截）
const issueProgressOptions: Record<string, { label: string; type: string }> = {
  none: { label: '未领料', type: 'info' },
  partial: { label: '部分领料', type: 'warning' },
  issued: { label: '已发料', type: 'success' },
  cancelled: { label: '已取消未发', type: 'info' },
}

// 未发口径：需求量 - 已发 - 已取消
function lineRemain(m: any) {
  return Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))
}

function issueProgress(order: any): string | null {
  if (!order || order.execStatus === 'none') return null
  const ms = order.materials || []
  if (ms.length === 0) return null
  const eps = 1e-6
  if (ms.every((m: any) => lineRemain(m) <= eps)) {
    return ms.every((m: any) => (m.issuedQty ?? 0) <= eps) ? 'cancelled' : 'issued'
  }
  if (ms.some((m: any) => (m.issuedQty ?? 0) > eps) || ms.some((m: any) => (m.cancelledQty ?? 0) > eps)) return 'partial'
  return 'none'
}

function workOrderOf(order: any) {
  // 发料只看生产订单状态：仅已关闭的订单不能领料（执行状态不参与）
  if (!order || order.status === 'closed') return null
  return order
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.orders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

// 发料在独立页面完成（跟单走），列表只负责带单号跳转
function openIssue(row: any) {
  router.push({ path: '/inventory/issue-make', query: { orderId: row.id } })
}

onMounted(async () => {
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产发料</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 180px" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', status: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="orderNo" label="生产订单号" width="150" />
        <el-table-column label="销售订单号" width="150">
          <template #default="{ row }">{{ row.salesOrder?.orderNo || row.salesOrderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发料状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="issueProgress(row)" size="small" :type="issueProgressOptions[issueProgress(row)!].type as any">
              {{ issueProgressOptions[issueProgress(row)!].label }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="!workOrderOf(row)" @click="openIssue(row)">领料</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
