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

const receiptTotal = computed(() =>
  (tracking.value?.receipts || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
)

const shipmentTotal = computed(() =>
  (tracking.value?.shipments || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
)

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
  const map: any = { draft: 'info', confirmed: 'primary', in_production: 'warning', completed: 'success', shipped: '', cancelled: 'danger', planned: 'info', in_progress: 'warning', reported: 'success', closed: 'info' }
  return map[s] || 'info'
}


function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// 未完工订单交期：逾期红色、今日琥珀色
function dueClass(row: any) {
  if (['completed', 'shipped', 'cancelled'].includes(row.status)) return ''
  const d = row.deliveryDate ? String(row.deliveryDate).slice(0, 10) : ''
  if (!d) return ''
  if (d < todayStr()) return 'due-overdue'
  if (d === todayStr()) return 'due-today'
  return ''
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
    <!-- 列表模式：选择订单 -->
    <div v-if="!hasId">
      <div class="page-card">
        <div class="table-toolbar">
          <span class="toolbar-title">订单跟踪</span>
          <div style="flex: 1" />
          <el-button @click="loadOrders"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>

        <div class="search-bar">
          <el-input v-model="query.orderNo" placeholder="订单号" clearable style="width: 200px" @keyup.enter="searchOrders" />
          <el-button type="primary" @click="searchOrders"><el-icon><Search /></el-icon>查询</el-button>
          <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadOrders()">重置</el-button>
        </div>

        <el-table :data="orders" v-loading="loading" stripe max-height="calc(100vh - 260px)">
          <el-table-column prop="orderNo" label="订单号" width="170" />
          <el-table-column prop="customerName" label="客户" min-width="150" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="交期" width="120">
            <template #default="{ row }">
              <span :class="dueClass(row)">{{ row.deliveryDate?.slice(0, 10) || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="120" align="right">
            <template #default="{ row }">¥{{ row.totalAmount?.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="goto(row.id)">跟踪</el-button>
            </template>
          </el-table-column>
                <template #empty>
          <el-empty description="没有符合条件的订单" :image-size="56">
            <div class="empty-tip">试试更短的订单号，或清空后重新查询</div>
          </el-empty>
        </template>
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
    </div>

    <!-- 详情模式：跟踪指定订单 -->
    <div v-else v-loading="loading">
      <div class="page-card" v-if="order">
        <div class="table-toolbar">
          <span class="toolbar-title">{{ order.orderNo }}</span>
          <el-tag :type="statusType(order.status)" style="margin-left: 12px">{{ statusLabel(order.status) }}</el-tag>
          <div style="flex: 1" />
          <el-button v-if="order.status === 'completed'" type="primary" plain @click="handleShip">
            <el-icon><Van /></el-icon>发货
          </el-button>
          <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
        </div>

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
          <el-table-column prop="quantity" label="数量" width="90" align="right" />
          <el-table-column prop="unitPrice" label="单价" width="100" align="right" />
          <el-table-column label="小计" width="110">
            <template #default="{ row }">¥{{ (row.quantity * row.unitPrice).toLocaleString() }}</template>
          </el-table-column>
        </el-table>
      </div>

      <div class="page-card" v-if="tracking">
        <div class="table-toolbar">
          <span class="toolbar-title">进度跟踪</span>
        </div>
        <el-table :data="tracking?.productionProgress || []" size="small" stripe default-expand-all>
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table v-if="row.workOrder" :data="[row.workOrder]" size="small" border style="margin: 4px 24px; width: auto">
                <el-table-column prop="plannedQty" label="计划量" width="90" />
                <el-table-column prop="completedQty" label="完成量" width="90" />
                <el-table-column prop="receivedQty" label="已入库" width="90" />
                <el-table-column label="工序进度" min-width="260">
                  <template #default="{ row: b }">
                    <span v-if="b.steps && b.steps.length">{{ b.steps.map((s: any) => `${s.name}:${s.reportedQty}`).join(' / ') }}</span>
                    <span v-else>-</span>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="100">
                  <template #default="{ row: w }">
                    <el-tag :type="statusType(w.status)" size="small">{{ statusLabel(w.status) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
              <div v-else style="padding: 8px 24px; color: var(--el-text-color-secondary)">未排产</div>
            </template>
          </el-table-column>
          <el-table-column prop="productionOrderNo" label="生产订单号" width="140" />
          <el-table-column prop="materialCode" label="物料编码" width="110" />
          <el-table-column prop="materialName" label="物料名称" min-width="140" />
          <el-table-column prop="quantity" label="计划数量" width="90" align="right" />
          <el-table-column label="计划周期" min-width="190">
            <template #default="{ row }">
              <span v-if="row.planStartDate">{{ row.planStartDate?.slice(0, 10) }} ~ {{ row.planEndDate?.slice(0, 10) }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="completedQty" label="已完工" width="90" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="workOrderCount" label="已排产" width="80" />
        </el-table>
      </div>

      <div class="page-card" v-if="tracking">
        <div class="table-toolbar">
          <span class="toolbar-title">入库信息</span>
          <div style="flex: 1" />
          <span style="color: var(--el-text-color-secondary); font-size: 13px">累计入库 {{ receiptTotal }}</span>
        </div>
        <el-table :data="tracking.receipts || []" size="small" stripe max-height="320">
          <el-table-column prop="documentNo" label="入库单号" width="160" />
          <el-table-column label="入库时间" width="160">
            <template #default="{ row }">{{ String(row.effectiveDate || row.createdAt || '').slice(0, 19).replace('T', ' ') }}</template>
          </el-table-column>
          <el-table-column label="产品" min-width="180">
            <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
          </el-table-column>
          <el-table-column label="仓库" min-width="130">
            <template #default="{ row }">{{ row.warehouseName ? `${row.warehouseCode} - ${row.warehouseName}` : '-' }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="入库数量" width="100" align="right" />
          <el-table-column prop="operatorName" label="操作员" width="100" />
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="!(tracking.receipts || []).length" description="暂无入库记录" :image-size="60" />
      </div>

      <div class="page-card" v-if="tracking">
        <div class="table-toolbar">
          <span class="toolbar-title">发运信息</span>
          <div style="flex: 1" />
          <span style="color: var(--el-text-color-secondary); font-size: 13px">累计发运 {{ shipmentTotal }}</span>
        </div>
        <el-table :data="tracking.shipments || []" size="small" stripe max-height="320">
          <el-table-column prop="documentNo" label="发运单号" width="160" />
          <el-table-column label="发运时间" width="160">
            <template #default="{ row }">{{ String(row.effectiveDate || row.createdAt || '').slice(0, 19).replace('T', ' ') }}</template>
          </el-table-column>
          <el-table-column label="产品" min-width="180">
            <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
          </el-table-column>
          <el-table-column label="出库仓库" min-width="130">
            <template #default="{ row }">{{ row.warehouseName ? `${row.warehouseCode} - ${row.warehouseName}` : '-' }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="发运数量" width="100" />
          <el-table-column prop="operatorName" label="操作员" width="100" />
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="!(tracking.shipments || []).length" description="暂无发运记录" :image-size="60" />
      </div>

      <el-empty v-if="!order && !loading" description="订单不存在" />
    </div>
  </div>
</template>
