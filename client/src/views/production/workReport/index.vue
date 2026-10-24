<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productionApi } from '../../../api'

const loading = ref(false)
const orderOptionsLoading = ref(false)
const orderOptions = ref<any[]>([])
const orderOptionMap = new Map<number, any>()
const currentOrder = ref<any>(null)
const steps = ref<any[]>([])
const rows = ref<any[]>([])
const submitting = ref(false)

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

function orderStatusLabel(s: string) {
  const map: Record<string, string> = { planned: '已计划', in_progress: '生产中', completed: '已完成', cancelled: '已取消' }
  return map[s] || s
}
function orderStatusType(s: string) {
  const map: Record<string, string> = { planned: 'info', in_progress: 'primary', completed: 'success', cancelled: 'danger' }
  return map[s] || 'info'
}
function batchStatusLabel(s: string) {
  const map: Record<string, string> = { planned: '待开工', in_progress: '加工中', completed: '已完成', closed: '已关闭', cancelled: '已取消' }
  return map[s] || s
}

async function loadOrder() {
  rows.value = []
  steps.value = []
  if (!query.orderNo) {
    currentOrder.value = null
    return
  }
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === query.orderNo)
  currentOrder.value = cached || null
  if (!currentOrder.value?.id) return
  loading.value = true
  try {
    const [routeRes, reportRes] = await Promise.all([
      productionApi.orderRoute(currentOrder.value.id),
      productionApi.reports({ orderNo: query.orderNo, pageSize: 1000 }),
    ])
    steps.value = routeRes.data.route?.processes || []
    const reportMap = new Map<string, number>()
    for (const r of reportRes.data.items || []) {
      const key = `${r.batchId}:${r.processStepId}`
      reportMap.set(key, (reportMap.get(key) || 0) + r.quantity)
    }
    const batches = (currentOrder.value.batches || []).filter((b: any) => b.status !== 'cancelled' && b.status !== 'closed')
    const out: any[] = []
    for (const b of batches) {
      for (const s of steps.value) {
        if (b.status === 'completed') continue
        out.push({
          batch: b,
          step: s,
          reported: reportMap.get(`${b.id}:${s.id}`) || 0,
          quantity: 0,
          scrapQty: 0,
          workHours: Math.round(((s.standardTime ?? 0) * 60) * 100) / 100, // 界面按分钟录入
          remark: '',
        })
      }
    }
    rows.value = out
  } catch {
    /* error shown */
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  if (!currentOrder.value) return
  const items = rows.value
    .filter((r) => r.quantity > 0)
    .map((r) => ({
      batchId: r.batch.id,
      processStepId: r.step.id,
      quantity: r.quantity,
      scrapQty: r.scrapQty || 0,
      workHours: Math.round(((r.workHours || 0) / 60) * 1e6) / 1e6, // 分钟 → 小时
      remark: r.remark || undefined,
    }))
  if (items.length === 0) {
    ElMessage.warning('请至少填写一条报工数量')
    return
  }
  submitting.value = true
  try {
    await productionApi.batchReport(currentOrder.value.id, items)
    ElMessage.success(`报工成功：${items.length} 条`)
    await loadOrder()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

// 批量填入：按「计划量 − 已报工」自动填入本次数量
function fillRemaining() {
  let filled = 0
  for (const r of rows.value) {
    const remain = Math.max(0, (Number(r.batch?.quantity) || 0) - (Number(r.reported) || 0))
    r.quantity = Math.round(remain * 100) / 100
    if (r.quantity > 0) filled++
  }
  if (filled === 0) ElMessage.info('各行工序均已报满，无需填入')
}

// 清除：清空本次数量
function clearQuantities() {
  for (const r of rows.value) r.quantity = 0
}

onMounted(loadOrderOptions)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">批次报工</span>
        <div style="flex: 1" />
        <el-button :disabled="!currentOrder || rows.length === 0" @click="fillRemaining"><el-icon><MagicStick /></el-icon>批量报工</el-button>
        <el-button :disabled="!currentOrder || rows.length === 0" @click="clearQuantities"><el-icon><Delete /></el-icon>清除</el-button>
        <el-button :loading="submitting" type="primary" :disabled="!currentOrder" @click="handleSubmit"><el-icon><Check /></el-icon>提交报工</el-button>
        <el-button :disabled="!currentOrder" @click="loadOrder"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-select v-model="query.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单" style="width: 320px" @change="loadOrder">
          <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
        </el-select>
        <el-button @click="loadOrder"><el-icon><Search /></el-icon>查询</el-button>
      </div>

      <el-card v-if="currentOrder" shadow="never" class="order-info-card" style="margin-bottom: 12px">
        <div class="order-info-header">
          <span class="order-info-title">{{ currentOrder.orderNo }}</span>
          <el-tag :type="orderStatusType(currentOrder.status)" size="small" effect="plain">{{ orderStatusLabel(currentOrder.status) }}</el-tag>
        </div>
        <div class="order-info-grid">
          <div class="order-info-item"><span class="order-info-label">产品</span><span>{{ currentOrder.material?.code }} - {{ currentOrder.material?.name }}</span></div>
          <div class="order-info-item"><span class="order-info-label">订单数量</span><span>{{ currentOrder.quantity }}</span></div>
          <div class="order-info-item"><span class="order-info-label">批次</span><span>{{ (currentOrder.batches || []).filter((b: any) => b.status !== 'cancelled').length }} 批</span></div>
          <div class="order-info-item"><span class="order-info-label">工序</span><span>{{ steps.length }} 道</span></div>
        </div>
      </el-card>

      <el-alert v-if="currentOrder && steps.length === 0" title="该订单尚未排产，无工序可报工。请先在“生产订单”中排产。" type="warning" show-icon :closable="false" style="margin-bottom: 12px" />

      <div v-loading="loading">
        <el-table :data="rows" stripe border max-height="calc(100vh - 330px)">
          <el-table-column label="批次" width="80" fixed="left">
            <template #default="{ row }">第{{ row.batch.batchNo }}批</template>
          </el-table-column>
          <el-table-column label="批次状态" width="90" fixed="left">
            <template #default="{ row }">
              <el-tag size="small" :type="row.batch.status === 'in_progress' ? 'primary' : 'info'" effect="plain">{{ batchStatusLabel(row.batch.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工序" min-width="130" fixed="left">
            <template #default="{ row }">{{ row.step.code }} {{ row.step.name }}</template>
          </el-table-column>
          <el-table-column label="计划量" width="80">
            <template #default="{ row }">{{ row.batch.quantity }}</template>
          </el-table-column>
          <el-table-column label="已报工" width="80">
            <template #default="{ row }">{{ row.reported }}</template>
          </el-table-column>
          <el-table-column label="本次数量" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="0" :controls="false" size="small" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column label="不良数量" width="110">
            <template #default="{ row }">
              <el-input-number v-model="row.scrapQty" :min="0" :controls="false" size="small" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column label="工时(分)" width="110">
            <template #default="{ row }">
              <el-input-number v-model="row.workHours" :min="0" :precision="2" :step="1" :controls="false" size="small" style="width: 100%" />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="130">
            <template #default="{ row }">
              <el-input v-model="row.remark" size="small" clearable />
            </template>
          </el-table-column>
                <template #empty>
          <el-empty description="还没有批次报工数据" :image-size="56">
            <div class="empty-tip">选择生产订单后按批次/工序录入报工；最后一道工序累计达标后批次自动完工</div>
          </el-empty>
        </template>
</el-table>
      </div>
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
  font-weight: 700;
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
