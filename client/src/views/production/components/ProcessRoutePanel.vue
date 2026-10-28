<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, processRouteApi, workstationApi } from '../../../api'

const props = withDefaults(defineProps<{ orderNo: string; order?: any; showTitle?: boolean }>(), {
  order: null,
  showTitle: true,
})

const emit = defineEmits<{
  (e: 'route-info', payload: { route: any; isOrderLevel: boolean }): void
}>()

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const route = ref<any>(null)
const isOrderLevel = ref(false)
const steps = ref<any[]>([])
let loadToken = 0

const canEditRoute = computed(() => isOrderLevel.value && !!props.order && props.order.status !== 'closed')
const routeLocked = computed(() => isOrderLevel.value && !!props.order && props.order.status === 'closed')

const workstations = ref<any[]>([])
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

async function loadRoute() {
  const token = ++loadToken
  route.value = null
  isOrderLevel.value = false
  steps.value = []
  emit('route-info', { route: null, isOrderLevel: false })
  if (!props.order?.id) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res: any = await productionApi.orderRoute(props.order.id)
    if (token !== loadToken) return
    route.value = res.data.route
    isOrderLevel.value = res.data.route?.isOrderLevel === true
    openEditor()
    emit('route-info', { route: route.value, isOrderLevel: isOrderLevel.value })
  } catch {
    /* error shown */
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch(() => props.order?.id, loadRoute, { immediate: true })

async function handleSave() {
  if (!isOrderLevel.value) {
    ElMessage.warning('未排产的订单不能编辑工艺路线，请先排产')
    return
  }
  if (routeLocked.value) {
    ElMessage.warning('生产订单已关闭，不能修改工艺路线')
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
    await productionApi.updateOrderRoute(props.order.id, {
      code: route.value.code,
      name: route.value.name,
      description: route.value.description,
    })
    // 再整表替换工序
    await productionApi.replaceOrderRouteSteps(
      props.order.id,
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
    await loadRoute()
  } catch {
    /* error shown */
  } finally {
    saving.value = false
  }
}

function printRoute() {
  router.push({ path: '/production/process-route-print', query: { orderNo: props.orderNo } })
}

onMounted(async () => {
  await Promise.all([loadWorkstations(), loadProcessNames()])
})
</script>

<template>
  <div>
    <div class="table-toolbar">
      <span v-if="showTitle" class="toolbar-title">订单工艺路线</span>
      <div style="flex: 1" />
      <el-button type="success" :disabled="!order" @click="printRoute"><el-icon><Printer /></el-icon>打印工艺路线</el-button>
      <el-button @click="loadRoute"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-alert v-if="order && !isOrderLevel && route" title="该订单尚未排产，当前显示标准工艺路线（只读）。排产后可编辑订单级工艺路线。" type="warning" show-icon :closable="false" style="margin-bottom: 12px" />
    <el-alert v-if="routeLocked" title="生产订单已关闭，工艺路线只读，不能修改。" type="info" show-icon :closable="false" style="margin-bottom: 12px" />

    <div v-loading="loading || saving">
      <el-empty v-if="!order" description="请先在上方选择生产订单" :image-size="56" />
      <template v-else>
      <div class="route-toolbar">
        <span class="route-meta">{{ route ? (route.description || '') : '' }}</span>
        <div style="flex: 1" />
        <el-button v-if="canEditRoute" size="small" type="primary" plain :disabled="!route" @click="pushStep"><el-icon><Plus /></el-icon>添加工序</el-button>
        <el-button v-if="canEditRoute" size="small" type="success" :disabled="!route" @click="handleSave"><el-icon><Check /></el-icon>保存工序</el-button>
      </div>

      <el-table :data="steps" stripe>
        <el-table-column label="序号" width="90">
          <template #default="{ row }">
            <el-input-number v-if="canEditRoute" v-model="row.sequence" :min="1" size="small" :controls="false" style="width: 80px" />
            <span v-else>{{ row.sequence }}</span>
          </template>
        </el-table-column>
        <el-table-column label="工序编码" width="110">
          <template #default="{ row }">
            <el-input v-if="canEditRoute" v-model="row.code" size="small" placeholder="如 OP001" />
            <span v-else>{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="工序名称" min-width="150">
          <template #default="{ row }">
            <el-select v-if="canEditRoute" v-model="row.name" size="small" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
              <el-option v-for="n in processNameOptions" :key="n" :label="n" :value="n" />
            </el-select>
            <span v-else>{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="工位" min-width="150">
          <template #default="{ row }">
            <el-select v-if="canEditRoute" v-model="row.workstationId" size="small" clearable placeholder="选择工位" style="width: 100%">
              <el-option v-for="w in workstations" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
            </el-select>
            <span v-else>{{ row.workstation?.code }} {{ row.workstation?.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="标准工时" width="90">
          <template #default="{ row }">
            <el-input-number v-if="canEditRoute" v-model="row.standardTime" :min="0" :controls="false" size="small" style="width: 100%" />
            <span v-else>{{ row.standardTime }}</span>
          </template>
        </el-table-column>
        <el-table-column label="准备工时" width="90">
          <template #default="{ row }">
            <el-input-number v-if="canEditRoute" v-model="row.setupTime" :min="0" :controls="false" size="small" style="width: 100%" />
            <span v-else>{{ row.setupTime }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canEditRoute" label="操作" width="70" fixed="right">
          <template #default="{ $index }">
            <el-button type="danger" link size="small" @click="removeStep($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.route-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
.route-meta {
  font-size: 12.5px;
  color: #909399;
}
</style>
