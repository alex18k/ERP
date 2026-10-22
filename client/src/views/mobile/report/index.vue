<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, systemApi } from '../../../api'

const route = useRoute()

const orderOptions = ref<any[]>([])
const orderOptionsLoading = ref(false)
const orderOptionMap = new Map<number, any>()
const selectedOrder = ref<any>(null)

const batchOptions = ref<any[]>([])
const routeSteps = ref<any[]>([])

const employeeOptions = ref<any[]>([])
const employeeLoading = ref(false)

const submitting = ref(false)

function nowDateTime() {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const form = reactive<any>({
  orderNo: '',
  batchId: null,
  processStepId: null,
  reportBy: null,
  quantity: 0,
  scrapQty: 0,
  workHours: 0,
  reportTime: nowDateTime(),
  remark: '',
})

const orderInfo = computed(() => selectedOrder.value)
const currentBatch = computed(() => batchOptions.value.find((b: any) => b.id === form.batchId) || null)

function registerOrderOptions(items: any[]) {
  for (const o of items) if (o?.id) orderOptionMap.set(o.id, o)
  // 下拉仅显示本次结果 + 当前已选订单（el-select remote 模式不做本地过滤）
  const selected = form.orderNo ? [...orderOptionMap.values()].find((o) => o.orderNo === form.orderNo) : null
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

async function loadEmployees(keyword: string = '') {
  employeeLoading.value = true
  try {
    const res: any = await systemApi.users({ pageSize: 100, keyword, status: 1 })
    employeeOptions.value = res.data.items || []
  } catch {
    /* ignore */
  } finally {
    employeeLoading.value = false
  }
}

async function onOrderChange() {
  routeSteps.value = []
  batchOptions.value = []
  form.batchId = null
  form.processStepId = null
  if (!form.orderNo) {
    selectedOrder.value = null
    return
  }
  selectedOrder.value = [...orderOptionMap.values()].find((o) => o.orderNo === form.orderNo) || null
  if (!selectedOrder.value) return
  batchOptions.value = (selectedOrder.value.batches || []).filter(
    (b: any) => b.status !== 'cancelled' && b.status !== 'completed',
  )
  try {
    const res: any = await productionApi.orderRoute(selectedOrder.value.id)
    routeSteps.value = res.data.route?.processes || []
  } catch {
    /* ignore */
  }
  await loadReports()
}

async function handleSave() {
  if (!form.batchId) { ElMessage.warning('请选择批次'); return }
  if (!form.processStepId) { ElMessage.warning('请选择工序'); return }
  if (!form.reportBy) { ElMessage.warning('请选择员工'); return }
  if (!form.quantity || form.quantity <= 0) { ElMessage.warning('请输入完成数量'); return }
  if (!form.reportTime) { ElMessage.warning('请选择日期'); return }
  submitting.value = true
  try {
    await productionApi.reportBatch(form.batchId, {
      processStepId: form.processStepId,
      quantity: form.quantity,
      scrapQty: form.scrapQty || 0,
      workHours: form.workHours || 0,
      reportTime: form.reportTime,
      reportBy: form.reportBy,
      remark: form.remark || undefined,
    })
    ElMessage.success('报工成功')
    form.quantity = 0
    form.scrapQty = 0
    form.workHours = 0
    form.remark = ''
    form.reportTime = nowDateTime()
    await refreshAfterSave()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

async function refreshAfterSave() {
  await loadReports()
  if (!form.orderNo) return
  const res: any = await productionApi.orders({ pageSize: 100, orderNo: form.orderNo })
  registerOrderOptions(res.data.items || [])
  selectedOrder.value = [...orderOptionMap.values()].find((o) => o.orderNo === form.orderNo) || selectedOrder.value
  batchOptions.value = (selectedOrder.value?.batches || []).filter(
    (b: any) => b.status !== 'cancelled' && b.status !== 'completed',
  )
  if (form.batchId && !batchOptions.value.some((b: any) => b.id === form.batchId)) form.batchId = null
}

// ===== 最近报工 =====
const reports = ref<any[]>([])
const reportLoading = ref(false)

async function loadReports() {
  if (!form.batchId) {
    reports.value = []
    return
  }
  reportLoading.value = true
  try {
    const res: any = await productionApi.reports({ page: 1, pageSize: 10, batchId: form.batchId })
    reports.value = res.data.items || []
  } catch {
    reports.value = []
  } finally {
    reportLoading.value = false
  }
}

onMounted(async () => {
  const qOrderNo = String(route.query.orderNo || '')
  await Promise.all([loadOrderOptions(qOrderNo), loadEmployees()])
  if (qOrderNo) {
    form.orderNo = qOrderNo
    await onOrderChange()
  }
})
</script>

<template>
  <div class="m-page">
    <header class="m-header">
      <div class="m-title">员工报工</div>
      <div class="m-sub">扫码报工 · 移动端</div>
    </header>

    <div class="m-body">
      <section class="m-card">
        <div class="m-field">
          <label>生产订单</label>
          <el-select
            v-model="form.orderNo"
            size="large"
            filterable
            remote
            clearable
            reserve-keyword
            :remote-method="loadOrderOptions"
            :loading="orderOptionsLoading"
            placeholder="选择生产订单"
            style="width: 100%"
            @change="onOrderChange"
          >
            <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
          </el-select>
        </div>

        <div v-if="orderInfo" class="m-order">
          <div class="m-order-row"><span>产品</span><b>{{ orderInfo.material?.code }} - {{ orderInfo.material?.name }}</b></div>
          <div class="m-order-row"><span>订单数量</span><b>{{ orderInfo.quantity }}</b></div>
          <div class="m-order-row"><span>状态</span><b>{{ orderInfo.status }}</b></div>
        </div>
      </section>

      <section class="m-card">
        <div class="m-field">
          <label>批次</label>
          <el-select v-model="form.batchId" size="large" clearable placeholder="选择批次" style="width: 100%" @change="loadReports">
            <el-option v-for="b in batchOptions" :key="b.id" :label="`第${b.batchNo}批（计划 ${b.quantity}）`" :value="b.id" />
          </el-select>
        </div>
        <div class="m-field">
          <label>工序</label>
          <el-select v-model="form.processStepId" size="large" filterable placeholder="选择工序（必选）" style="width: 100%">
            <el-option v-for="s in routeSteps" :key="s.id" :label="`${s.code} ${s.name}`" :value="s.id" />
          </el-select>
        </div>
        <div class="m-field">
          <label>员工</label>
          <el-select
            v-model="form.reportBy"
            size="large"
            filterable
            remote
            clearable
            reserve-keyword
            :remote-method="loadEmployees"
            :loading="employeeLoading"
            placeholder="选择员工"
            style="width: 100%"
          >
            <el-option v-for="u in employeeOptions" :key="u.id" :label="`${u.realName || u.username}（${u.username}）`" :value="u.id" />
          </el-select>
        </div>
      </section>

      <section class="m-card">
        <div class="m-grid">
          <div class="m-field">
            <label>完成数量</label>
            <el-input-number v-model="form.quantity" size="large" :min="0" :controls="false" style="width: 100%" />
          </div>
          <div class="m-field">
            <label>不良品数</label>
            <el-input-number v-model="form.scrapQty" size="large" :min="0" :controls="false" style="width: 100%" />
          </div>
          <div class="m-field">
            <label>工时(h)</label>
            <el-input-number v-model="form.workHours" size="large" :min="0" :precision="2" :step="0.1" :controls="false" style="width: 100%" />
          </div>
        </div>
        <div class="m-field">
          <label>日期</label>
          <el-date-picker v-model="form.reportTime" size="large" type="datetime" value-format="YYYY-MM-DDTHH:mm" style="width: 100%" />
        </div>
        <div class="m-field">
          <label>备注</label>
          <el-input v-model="form.remark" size="large" clearable placeholder="选填" />
        </div>
      </section>

      <section v-if="form.batchId" class="m-card">
        <div class="m-section-title">
          最近报工
          <span v-if="currentBatch">（第{{ currentBatch.batchNo }}批）</span>
        </div>
        <div v-loading="reportLoading" class="m-report-list">
          <div v-for="r in reports" :key="r.id" class="m-report-item">
            <div class="m-report-main">
              <b>{{ r.processStep ? `${r.processStep.code} ${r.processStep.name}` : '-' }}</b>
              <span class="m-report-qty">{{ r.quantity }}</span>
            </div>
            <div class="m-report-meta">
              <span>{{ r.reporter?.realName ?? '-' }}</span>
              <span>{{ String(r.reportTime).slice(0, 16) }}</span>
              <span v-if="r.scrapQty > 0" class="m-scrap">不良 {{ r.scrapQty }}</span>
            </div>
          </div>
          <div v-if="!reportLoading && reports.length === 0" class="m-empty">暂无报工记录</div>
        </div>
      </section>
    </div>

    <footer class="m-footer">
      <el-button class="m-clear" size="large" @click="Object.assign(form, { quantity: 0, scrapQty: 0, workHours: 0, remark: '' })">清空</el-button>
      <el-button class="m-submit" type="primary" size="large" :loading="submitting" @click="handleSave">提交报工</el-button>
    </footer>
  </div>
</template>

<style scoped>
.m-page {
  min-height: 100vh;
  background: #f7f8f5;
  color: #1d2622;
  max-width: 560px;
  margin: 0 auto;
  padding-bottom: 84px;
  box-sizing: border-box;
}

.m-header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 14px 16px 12px;
  background: linear-gradient(180deg, #124ACC, #165DFF);
  color: #fff;
  box-shadow: 0 2px 10px rgba(22, 35, 30, 0.18);
}
.m-title { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; }
.m-sub { font-size: 12px; opacity: 0.85; margin-top: 2px; }

.m-body { padding: 12px; display: flex; flex-direction: column; gap: 12px; }

.m-card {
  background: #fff;
  border: 1px solid #dce0da;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 1px 3px rgba(22, 35, 30, 0.05);
}

.m-field { margin-bottom: 12px; }
.m-field:last-child { margin-bottom: 0; }
.m-field label {
  display: block;
  font-size: 13px;
  color: #6d7670;
  margin-bottom: 6px;
}

.m-grid { display: flex; flex-direction: column; gap: 0; }

.m-order {
  border-top: 1px dashed #dce0da;
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.m-order-row { display: flex; justify-content: space-between; font-size: 13px; gap: 12px; }
.m-order-row span { color: #8a9199; flex-shrink: 0; }
.m-order-row b { font-weight: 600; text-align: right; word-break: break-all; }

.m-section-title { font-size: 14px; font-weight: 700; margin-bottom: 10px; color: #1d2622; }
.m-section-title span { font-size: 12px; color: #165DFF; font-weight: 500; }

.m-report-list { display: flex; flex-direction: column; gap: 8px; }
.m-report-item {
  border: 1px solid #e6e9e4;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafbf9;
}
.m-report-main { display: flex; justify-content: space-between; font-size: 13px; }
.m-report-qty { font-weight: 700; color: #165DFF; }
.m-report-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: #8a9199; margin-top: 4px; }
.m-scrap { color: #b3402e; }
.m-empty { text-align: center; color: #9aa39c; font-size: 13px; padding: 12px 0; }

.m-footer {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: 100%;
  max-width: 560px;
  display: flex;
  gap: 10px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #dce0da;
  box-sizing: border-box;
}
.m-clear { flex: 0 0 30%; }
.m-submit { flex: 1; font-weight: 600; letter-spacing: 0.1em; }

.m-page :deep(.el-select__wrapper),
.m-page :deep(.el-input__wrapper) { border-radius: 8px; }
</style>
