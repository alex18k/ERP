<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { productionApi } from '../../../api'
import MaterialListPanel from '../components/MaterialListPanel.vue'
import ProcessRoutePanel from '../components/ProcessRoutePanel.vue'

const query = reactive({ orderNo: '' })
const currentOrder = ref<any>(null)
const activeTab = ref('materials')
let orderToken = 0
let orderOptionsToken = 0

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
  const token = ++orderOptionsToken
  orderOptionsLoading.value = true
  try {
    const res: any = await productionApi.orders({ pageSize: 100, orderNo: keyword })
    if (token !== orderOptionsToken) return
    registerOrderOptions(res.data.items || [])
  } catch {
    /* ignore */
  } finally {
    if (token === orderOptionsToken) orderOptionsLoading.value = false
  }
}

async function onOrderChange() {
  const token = ++orderToken
  if (!query.orderNo) {
    currentOrder.value = null
    return
  }
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === query.orderNo)
  currentOrder.value = cached || null
  try {
    const res: any = await productionApi.orders({ pageSize: 20, orderNo: query.orderNo })
    if (token !== orderToken) return
    const items = res.data.items || []
    registerOrderOptions(items)
    const exact = items.find((o: any) => o.orderNo === query.orderNo)
    if (exact) currentOrder.value = exact
  } catch {
    if (token === orderToken && !cached) currentOrder.value = null
  }
}

function clearOrder() {
  orderToken++
  query.orderNo = ''
  currentOrder.value = null
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

function execStatusLabel(s: string) {
  const map: Record<string, string> = {
    none: '未排产',
    pending: '待开工',
    in_progress: '生产中',
    completed: '已完成',
    closed: '已关闭',
  }
  return map[s] || s || '-'
}

function execStatusType(s: string) {
  const map: Record<string, string> = {
    none: 'info',
    pending: 'info',
    in_progress: 'warning',
    completed: 'success',
    closed: 'info',
  }
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
        <span class="toolbar-title">生产订单配置</span>
      </div>

      <div class="search-bar">
        <span class="search-label">生产订单</span>
        <el-select v-model="query.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单" style="width: 300px" @change="onOrderChange">
          <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
        </el-select>
        <el-button v-if="query.orderNo" @click="clearOrder">清空订单</el-button>
      </div>

      <el-card v-if="currentOrder" shadow="never" class="order-info-card" style="margin-bottom: 12px">
        <div class="order-info-header">
          <span class="order-info-title">{{ currentOrder.orderNo }}</span>
          <el-tag :type="orderStatusType(currentOrder.status)" size="small" effect="plain">{{ orderStatusLabel(currentOrder.status) }}</el-tag>
          <el-tag :type="execStatusType(currentOrder.execStatus)" size="small">{{ execStatusLabel(currentOrder.execStatus) }}</el-tag>
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
            <span class="order-info-label">已入库</span>
            <span>{{ currentOrder.receivedQty ?? 0 }}</span>
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

      <el-tabs v-model="activeTab">
        <el-tab-pane label="生产领料单维护" name="materials">
          <MaterialListPanel :order-no="query.orderNo" :order="currentOrder" require-order />
        </el-tab-pane>
        <el-tab-pane label="生产订单工艺路线" name="route">
          <ProcessRoutePanel :order-no="query.orderNo" :order="currentOrder" />
        </el-tab-pane>
      </el-tabs>
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
  flex-basis: 33.33%;
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
