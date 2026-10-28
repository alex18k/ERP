<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { productionApi } from '../../../api'
import MaterialListPanel from '../components/MaterialListPanel.vue'

const route = useRoute()
const initialOrderNo = typeof route.query.orderNo === 'string' ? route.query.orderNo : ''

const currentOrder = ref<any>(null)
const query = reactive({ orderNo: initialOrderNo })
let orderToken = 0

function clearOrder() {
  orderToken++
  query.orderNo = ''
  currentOrder.value = null
}

// ===== 生产订单下拉 =====
const orderOptionsLoading = ref(false)
const orderOptions = ref<any[]>([])
const orderOptionMap = new Map<number, any>()

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

async function loadCurrentOrder(orderNo: string) {
  const token = ++orderToken
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === orderNo)
  if (cached) {
    currentOrder.value = cached
    return
  }
  try {
    const res: any = await productionApi.orders({ pageSize: 5, orderNo })
    if (token !== orderToken) return
    const items = res.data.items || []
    currentOrder.value = items.find((o: any) => o.orderNo === orderNo) || items[0] || null
  } catch {
    if (token === orderToken) currentOrder.value = null
  }
}

async function onOrderChange() {
  if (!query.orderNo) {
    orderToken++
    currentOrder.value = null
    return
  }
  await loadCurrentOrder(query.orderNo)
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  return String(d).slice(0, 10)
}

function orderStatusLabel(s: string) {
  const map: Record<string, string> = {
    planned: '已计划',
    in_progress: '生产中',
    closed: '已关闭',
    released: '已下达',
  }
  return map[s] || s
}

function orderStatusType(s: string) {
  const map: Record<string, string> = {
    planned: 'info',
    in_progress: 'primary',
    closed: 'info',
    released: 'warning',
  }
  return map[s] || 'info'
}

onMounted(async () => {
  if (initialOrderNo) {
    await loadOrderOptions(initialOrderNo)
    await loadCurrentOrder(initialOrderNo)
  } else {
    await loadOrderOptions()
  }
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产领料单（物料清单）</span>
      </div>

      <div class="search-bar">
        <span class="search-label">生产订单</span>
        <el-select v-model="query.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单查看该单清单" style="width: 300px" @change="onOrderChange">
          <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
        </el-select>
        <el-button v-if="query.orderNo" @click="clearOrder">清空订单</el-button>
      </div>

      <el-card v-if="currentOrder" shadow="never" class="order-info-card" style="margin-bottom: 12px">
        <div class="order-info-header">
          <span class="order-info-title">{{ currentOrder.orderNo }}</span>
          <el-tag :type="orderStatusType(currentOrder.status)" size="small" effect="plain">{{ orderStatusLabel(currentOrder.status) }}</el-tag>
        </div>
        <div class="order-info-grid">
          <div class="order-info-item">
            <span class="order-info-label">产品</span>
            <span>{{ currentOrder.material?.code }} - {{ currentOrder.material?.name }}</span>
          </div>
          <div class="order-info-item">
            <span class="order-info-label">订单数量</span>
            <span>{{ currentOrder.quantity }}</span>
          </div>
          <div class="order-info-item">
            <span class="order-info-label">生产订单</span>
            <span>{{ currentOrder.orderNo }}</span>
          </div>
          <div class="order-info-item">
            <span class="order-info-label">计划周期</span>
            <span>{{ fmtDate(currentOrder.planStartDate) }} ~ {{ fmtDate(currentOrder.planEndDate) }}</span>
          </div>
          <div class="order-info-item">
            <span class="order-info-label">计划员</span>
            <span>{{ currentOrder.planner || '-' }}</span>
          </div>
          <div class="order-info-item">
            <span class="order-info-label">下达日期</span>
            <span>{{ fmtDate(currentOrder.releaseDate) }}</span>
          </div>
        </div>
      </el-card>

      <MaterialListPanel :order-no="query.orderNo" :order="currentOrder" :show-title="false" />
    </div>
  </div>
</template>

<style scoped>
.search-label {
  color: var(--el-text-color-regular);
}

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
</style>
