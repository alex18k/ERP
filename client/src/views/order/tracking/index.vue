<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderApi } from '../../../api'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const order = ref<any>(null)
const tracking = ref<any>(null)

const hasId = computed(() => !!route.query.id)

// 列表模式（从菜单进入，未指定订单）
const orders = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

async function loadOrders() {
  loading.value = true
  try {
    const res: any = await orderApi.list(query)
    orders.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

async function loadData() {
  const id = Number(route.query.id)
  if (!id) return
  loading.value = true
  try {
    const res: any = await orderApi.get(id)
    order.value = res.data
    const trackRes: any = await orderApi.track(id)
    tracking.value = trackRes.data
  } finally { loading.value = false }
}

function searchOrders() {
  query.page = 1
  loadOrders()
}

function goto(id: number) {
  router.push({ path: '/order/tracking', query: { id } })
}

async function handleShip() {
  if (!order.value) return
  try {
    await ElMessageBox.confirm(`确认订单 ${order.value.orderNo} 已完成生产并安排发货？`, '发货确认', { type: 'warning' })
    await orderApi.ship(order.value.id)
    ElMessage.success('订单已发货')
    loadData()
  } catch { /* canceled */ }
}

function statusLabel(s: string) {
  return {
    draft: '草稿', confirmed: '已确认', in_production: '生产中', completed: '已完工', shipped: '已发货', cancelled: '已取消',
    planned: '已计划', scheduled: '已排产', in_progress: '加工中', pending: '待开工', paused: '已暂停', quality_check: '质检中', reported: '已报工', closed: '已关闭',
  }[s] || s
}

function statusType(s: string) {
  const map: any = { draft: 'info', confirmed: 'primary', in_production: 'warning', completed: 'success', shipped: '', cancelled: 'danger', planned: 'info', in_progress: 'warning', reported: 'success' }
  return map[s] || 'info'
}

onMounted(() => {
  if (hasId.value) loadData()
  else loadOrders()
})

watch(() => route.query.id, (id) => {
  if (id) {
    order.value = null
    tracking.value = null
    loadData()
  } else {
    loadOrders()
  }
})
</script>

<template>
  <div class="page-container">
    <el-page-header @back="router.back()" content="订单跟踪" style="margin-bottom: 20px" />

    <!-- 列表模式：选择订单 -->
    <div v-if="!hasId">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="订单号" clearable style="width: 200px" @keyup.enter="searchOrders" />
        <el-button type="primary" @click="searchOrders"><el-icon><Search /></el-icon>查询</el-button>
      </div>

      <el-table :data="orders" v-loading="loading" stripe>
        <el-table-column prop="orderNo" label="订单号" width="170" />
        <el-table-column prop="customerName" label="客户" min-width="150" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交期" width="120">
          <template #default="{ row }">{{ row.deliveryDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120">
          <template #default="{ row }">¥{{ row.totalAmount?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="goto(row.id)">跟踪</el-button>
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
          @change="loadOrders"
        />
      </div>
    </div>

    <!-- 详情模式：跟踪指定订单 -->
    <div v-else v-loading="loading">
      <el-card v-if="order" class="mb-16">
        <template #header>
          <div class="head-flex">
            <span>{{ order.orderNo }}</span>
            <el-tag :type="statusType(order.status)" style="margin-left: 12px">{{ statusLabel(order.status) }}</el-tag>
            <el-button v-if="order.status === 'completed'" size="small" type="primary" style="margin-left: auto" @click="handleShip">
              <el-icon><Van /></el-icon>发货
            </el-button>
          </div>
        </template>
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="客户">{{ order.customerName }}</el-descriptions-item>
          <el-descriptions-item label="金额">¥{{ order.totalAmount?.toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="交期">{{ order.deliveryDate?.slice(0, 10) || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-table :data="order.items" size="small" style="margin-top: 16px" stripe>
          <el-table-column prop="materialId" label="物料ID" width="80" />
          <el-table-column label="产品" min-width="160">
            <template #default="{ row }">{{ row.material?.code }} - {{ row.material?.name }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="数量" width="90" />
          <el-table-column prop="unitPrice" label="单价" width="100" />
          <el-table-column label="小计" width="110">
            <template #default="{ row }">¥{{ (row.quantity * row.unitPrice).toLocaleString() }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card v-if="tracking" class="mb-16">
        <template #header>进度跟踪</template>
        <el-table :data="tracking?.productionProgress || []" size="small" stripe>
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table v-if="row.workOrders && row.workOrders.length" :data="row.workOrders" size="small" border style="margin: 4px 24px; width: auto">
                <el-table-column prop="orderNo" label="加工单号" width="150" />
                <el-table-column prop="processStep" label="工序" width="110" />
                <el-table-column prop="workstation" label="工位" width="110" />
                <el-table-column prop="plannedQty" label="计划量" width="90" />
                <el-table-column prop="actualQty" label="实际量" width="90" />
                <el-table-column label="状态" width="100">
                  <template #default="{ row: w }">
                    <el-tag :type="statusType(w.status)" size="small">{{ statusLabel(w.status) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
              <div v-else style="padding: 8px 24px; color: var(--el-text-color-secondary)">未排产，暂无加工单</div>
            </template>
          </el-table-column>
          <el-table-column prop="productionOrderNo" label="生产订单号" width="140" />
          <el-table-column prop="materialCode" label="物料编码" width="110" />
          <el-table-column prop="materialName" label="物料名称" min-width="140" />
          <el-table-column prop="quantity" label="计划数量" width="90" />
          <el-table-column prop="completedQty" label="已完工" width="90" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="workOrderCount" label="加工单" width="100" />
        </el-table>
      </el-card>

      <el-empty v-if="!order && !loading" description="订单不存在" />
    </div>
  </div>
</template>
<style scoped>
.head-flex {
  display: flex;
  align-items: center;
}
</style>
