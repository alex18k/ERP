<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, processRouteApi, workstationApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const orderOptionsLoading = ref(false)
const orderOptions = ref<any[]>([])
const orderOptionMap = new Map<number, any>()
const currentOrder = ref<any>(null)
const route = ref<any>(null)
const isOrderLevel = ref(false)

const query = reactive({ orderNo: '' })

function registerOrderOptions(items: any[]) {
  for (const o of items) if (o?.id) orderOptionMap.set(o.id, o)
  orderOptions.value = [...orderOptionMap.values()]
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
  route.value = null
  steps.value = []
  isOrderLevel.value = false
  if (!query.orderNo) {
    currentOrder.value = null
    return
  }
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === query.orderNo)
  currentOrder.value = cached || null
  loading.value = true
  try {
    const id = currentOrder.value?.id
    const res: any = await productionApi.orderRoute(id)
    route.value = res.data.route
    isOrderLevel.value = res.data.route?.isOrderLevel === true
    openEditor()
  } catch {
    /* error shown */
  } finally {
    loading.value = false
  }
}

function orderStatusLabel(s: string) {
  const map: Record<string, string> = { planned: '已计划', in_progress: '生产中', completed: '已完成', cancelled: '已取消', released: '已下达' }
  return map[s] || s
}
function orderStatusType(s: string) {
  const map: Record<string, string> = { planned: 'info', in_progress: 'primary', completed: 'success', cancelled: 'danger', released: 'warning' }
  return map[s] || 'info'
}

// ===== 工序编辑 =====
const workstations = ref<any[]>([])
const saving = ref(false)
const steps = ref<any[]>([])
const processNameOptions = ref<string[]>([])

function pushStep() {
  steps.value.push({ id: undefined as any, code: '', name: '', sequence: steps.value.length + 1, workstationId: null, standardTime: 0, setupTime: 0 })
}

function removeStep(index: number) {
  steps.value.splice(index, 1)
}

async function loadWorkstations() {
  const res: any = await workstationApi.list()
  workstations.value = res.data || []
}

// 工序名称候选：取标准工艺路线里已有的工序名，便于快速选用
async function loadProcessNames() {
  try {
    const res: any = await processRouteApi.list({ pageSize: 500 })
    const names = new Set<string>()
    for (const r of res.data.items || []) {
      for (const p of r.processes || []) if (p.name) names.add(p.name)
    }
    processNameOptions.value = [...names]
  } catch {
    /* ignore */
  }
}

function openEditor() {
  steps.value = (route.value?.processes || []).map((p: any) => ({ ...p }))
}

async function handleSave() {
  if (!isOrderLevel.value) {
    ElMessage.warning('未排产的订单不能编辑工艺路线，请先排产')
    return
  }
  if (steps.value.length === 0) {
    ElMessage.warning('请至少保留一个工序')
    return
  }
  let invalid = false
  for (const s of steps.value) {
    if (!s.name) { invalid = true; break }
  }
  if (invalid) {
    ElMessage.warning('工序名称不能为空')
    return
  }
  saving.value = true
  try {
    // 先更新表头
    await productionApi.updateOrderRoute(currentOrder.value.id, {
      code: route.value.code,
      name: route.value.name,
      description: route.value.description,
    })
    // 再整表替换工序
    await productionApi.replaceOrderRouteSteps(
      currentOrder.value.id,
      steps.value.map((p, i) => ({
        id: p.id,
        code: p.code || `OP${i + 1}`,
        name: p.name,
        sequence: p.sequence || i + 1,
        workstationId: p.workstationId,
        standardTime: p.standardTime ?? 0,
        setupTime: p.setupTime ?? 0,
      }))
    )
    ElMessage.success('工艺路线已更新')
    await onOrderChange()
  } catch {
    /* error shown */
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadOrderOptions(), loadWorkstations(), loadProcessNames()])
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">加工单工艺路线</span>
        <div style="flex: 1" />
        <el-button type="success" :disabled="!currentOrder" @click="router.push({ path: '/production/process-route-print', query: { orderNo: currentOrder?.orderNo } })"><el-icon><Printer /></el-icon>打印工艺路线</el-button>
        <el-button @click="onOrderChange"><el-icon><Refresh /></el-icon>刷新</el-button>
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
          <div class="order-info-item"><span class="order-info-label">批次</span><span>{{ (currentOrder.batches || []).filter((b: any) => b.status !== 'cancelled').length }} 批</span></div>
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

      <el-alert v-if="currentOrder && !isOrderLevel && route" title="该订单尚未排产，当前显示标准工艺路线（只读）。排产后可编辑订单级工艺路线。" type="warning" show-icon :closable="false" style="margin-bottom: 12px" />

      <div v-loading="loading || saving">
        <div class="route-toolbar">
          <span class="route-meta">{{ route ? (route.description || '') : '' }}</span>
          <div style="flex: 1" />
          <el-button v-if="isOrderLevel" size="small" type="primary" plain :disabled="!route" @click="pushStep"><el-icon><Plus /></el-icon>添加工序</el-button>
          <el-button v-if="isOrderLevel" size="small" type="success" :disabled="!route" @click="handleSave"><el-icon><Check /></el-icon>保存工序</el-button>
        </div>

        <el-table :data="steps" stripe>
          <el-table-column label="序号" width="90">
            <template #default="{ row }">
              <el-input-number v-if="isOrderLevel" v-model="row.sequence" :min="1" size="small" :controls="false" style="width: 80px" />
              <span v-else>{{ row.sequence }}</span>
            </template>
          </el-table-column>
          <el-table-column label="工序编码" width="110">
            <template #default="{ row }">
              <el-input v-if="isOrderLevel" v-model="row.code" size="small" placeholder="如 OP001" />
              <span v-else>{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column label="工序名称" min-width="150">
            <template #default="{ row }">
              <el-select v-if="isOrderLevel" v-model="row.name" size="small" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                <el-option v-for="n in processNameOptions" :key="n" :label="n" :value="n" />
              </el-select>
              <span v-else>{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="工位" min-width="150">
            <template #default="{ row }">
              <el-select v-if="isOrderLevel" v-model="row.workstationId" size="small" clearable placeholder="选择工位" style="width: 100%">
                <el-option v-for="w in workstations" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
              </el-select>
              <span v-else>{{ row.workstation?.code }} {{ row.workstation?.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="标准工时" width="90">
            <template #default="{ row }">
              <el-input-number v-if="isOrderLevel" v-model="row.standardTime" :min="0" :controls="false" size="small" style="width: 100%" />
              <span v-else>{{ row.standardTime }}</span>
            </template>
          </el-table-column>
          <el-table-column label="准备工时" width="90">
            <template #default="{ row }">
              <el-input-number v-if="isOrderLevel" v-model="row.setupTime" :min="0" :controls="false" size="small" style="width: 100%" />
              <span v-else>{{ row.setupTime }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="isOrderLevel" label="操作" width="70" fixed="right">
            <template #default="{ $index }">
              <el-button type="danger" link size="small" @click="removeStep($index)">删除</el-button>
            </template>
          </el-table-column>
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
.route-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.route-meta {
  font-size: 12.5px;
  color: #909399;
}
.muted {
  color: #b0b7c3;
}
</style>
