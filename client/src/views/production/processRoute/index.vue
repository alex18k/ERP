<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { productionApi } from '../../../api'
import ProcessRoutePanel from '../components/ProcessRoutePanel.vue'

const orderOptionsLoading = ref(false)
const orderOptions = ref<any[]>([])
const orderOptionMap = new Map<number, any>()
const currentOrder = ref<any>(null)
const routeInfo = ref<{ route: any; isOrderLevel: boolean }>({ route: null, isOrderLevel: false })
const route = computed(() => routeInfo.value.route)
const isOrderLevel = computed(() => routeInfo.value.isOrderLevel)

const query = reactive({ orderNo: '' })

function registerOrderOptions(items: any[]) {
  for (const o of items) if (o?.id) orderOptionMap.set(o.id, o)
  // 下拉仅显示本次结果 + 当前已选订单（el-select remote 模式不做本地过滤）
  const selected = query.orderNo ? [...orderOptionMap.values()].find((o) => o.orderNo === query.orderNo) : null
  const seen = new Set<number>()
  orderOptions.value = [...items, ...(selected ? [selected] : [])].filter((o: any) => {
    if (!o?.id || seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })
}

async function loadOrderOptions(keyword: string = '') {
  orderOptionsLoading.value = true
  try {
    const res: any = await productionApi.orders({ pageSize: 100, orderNo: keyword })
    registerOrderOptions(res.data.items || [])
  } catch {
    /* ignore */
  } finally {
    orderOptionsLoading.value = false
  }
}

async function onOrderChange() {
  routeInfo.value = { route: null, isOrderLevel: false }
  if (!query.orderNo) {
    currentOrder.value = null
    return
  }
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === query.orderNo)
  currentOrder.value = cached || null
}

function onRouteInfo(payload: { route: any; isOrderLevel: boolean }) {
  routeInfo.value = payload
}

function orderStatusLabel(s: string) {
  const map: Record<string, string> = { planned: '已计划', in_progress: '生产中', closed: '已关闭', released: '已下达' }
  return map[s] || s
}
function orderStatusType(s: string) {
  const map: Record<string, string> = { planned: 'info', in_progress: 'primary', closed: 'info', released: 'warning' }
  return map[s] || 'info'
}

onMounted(async () => {
  await loadOrderOptions()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">订单工艺路线</span>
      </div>

      <div class="search-bar">
        <el-select v-model="query.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单" style="width: 280px" @change="onOrderChange">
          <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
        </el-select>
        <el-button @click="onOrderChange"><el-icon><Search /></el-icon>查询</el-button>
      </div>

      <el-card v-if="currentOrder" shadow="never" class="order-info-card" style="margin-bottom: 12px">
        <div class="order-info-header">
          <span class="order-info-title">{{ currentOrder.orderNo }}</span>
          <el-tag :type="orderStatusType(currentOrder.status)" size="small" effect="plain">{{ orderStatusLabel(currentOrder.status) }}</el-tag>
          <el-tag v-if="isOrderLevel" type="success" size="small" effect="plain">订单级</el-tag>
          <el-tag v-else-if="route" type="warning" size="small" effect="plain">标准路线（只读）</el-tag>
        </div>
        <div class="order-info-grid">
          <div class="order-info-item"><span class="order-info-label">产品</span><span>{{ currentOrder.material?.code }} - {{ currentOrder.material?.name }}</span></div>
          <div class="order-info-item"><span class="order-info-label">订单数量</span><span>{{ currentOrder.quantity }}</span></div>
          <div class="order-info-item"><span class="order-info-label">生产订单</span><span>{{ currentOrder.orderNo || '-' }}</span></div>
          <div class="order-info-item">
            <span class="order-info-label">工艺路线</span>
            <span v-if="route">{{ route.code }} - {{ route.name }}</span>
            <span v-else class="muted">未指定</span>
          </div>
          <div v-if="isOrderLevel && route?.sourceRoute" class="order-info-item">
            <span class="order-info-label">来源标准路线</span>
            <span class="muted">{{ route.sourceRoute.code }} - {{ route.sourceRoute.name }}</span>
          </div>
        </div>
      </el-card>

      <ProcessRoutePanel :order-no="query.orderNo" :order="currentOrder" :show-title="false" @route-info="onRouteInfo" />
    </div>
  </div>
</template>

<style scoped>
.order-info-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.order-info-title {
  font-size: 15px;
  font-weight: 600;
}
.order-info-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
}
.order-info-item {
  flex-basis: 25%;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  min-width: 0;
}
.order-info-label {
  flex-shrink: 0;
  color: #909399;
}
.muted {
  color: #b0b7c3;
}
</style>
