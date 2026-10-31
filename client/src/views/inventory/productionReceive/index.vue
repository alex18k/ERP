<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi, stockApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const handlerOptions = ref<string[]>([])
const keeperOptions = ref<string[]>([])
const query = reactive({ page: 1, pageSize: 20, orderNo: '' })

const dialogVisible = ref(false)
const submitting = ref(false)
const current = ref<any>(null)
const form = reactive<any>({ quantity: 0, unit: '', warehouseId: null, binId: null, batchNo: '', closeWorkOrder: false, effectiveDate: '', handler: '', keeper: '' })

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const binRequired = computed(() => selectedWarehouse.value?.binManaged === true)

async function loadBins() {
  form.binId = null
  bins.value = []
  const wh = selectedWarehouse.value
  if (!wh?.binManaged) return
  const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
  bins.value = res.data.items
}

// 入库计量单位（产品基本单位 + 转换单位）与换算提示
const productMaterial = computed(() => current.value?.material || null)
const unitOptions = computed<string[]>(() => {
  const m = productMaterial.value
  const set = new Set<string>()
  if (m?.units) for (const u of m.units) set.add(u)
  if (form.unit) set.add(form.unit)
  return [...set]
})
const unitRate = computed(() => {
  const m = productMaterial.value
  if (!m?.unit || !form.unit || form.unit === m.unit) return 1
  return m.unitRates?.[form.unit] || 0
})
const baseHint = computed(() => {
  const m = productMaterial.value
  if (!m?.unit || !form.unit || form.unit === m.unit) return ''
  if (!unitRate.value) return ''
  return `= ${Number(((Number(form.quantity) || 0) * unitRate.value).toFixed(6))} ${m.unit}`
})

function remaining(row: any) {
  return (row.plannedQty ?? 0) - (row.receivedQty ?? 0)
}

// 状态：与生产领料页一致，显示所属生产订单的状态
const statusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '已下达', value: 'in_progress', type: 'warning' },
  { label: '已关闭', value: 'closed', type: 'info' },
]

function statusLabel(s: any) {
  return statusOptions.find((o) => o.value === s)?.label || s || '-'
}

function statusType(s: any) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

const execStatusOptions = [
  { label: '未排产', value: 'none', type: 'info' },
  { label: '待开工', value: 'pending', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已完成', value: 'completed', type: 'success' },
]

function execStatusLabel(s: any) {
  return execStatusOptions.find((o) => o.value === s)?.label || s || '-'
}

function execStatusType(s: any) {
  return execStatusOptions.find((o) => o.value === s)?.type || 'info'
}

// 发料状态：与生产发料页同口径（按领料明细 已发/未发 汇总，取消未发计入已结清）
const issueProgressOptions: Record<string, { label: string; type: string }> = {
  none: { label: '未领料', type: 'info' },
  partial: { label: '部分领料', type: 'warning' },
  issued: { label: '已发料', type: 'success' },
  cancelled: { label: '已取消未发', type: 'info' },
}
function issueProgress(row: any): string | null {
  const ms = row.materials || []
  if (ms.length === 0) return null
  const eps = 1e-6
  const remain = (m: any) => Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))
  if (ms.every((m: any) => remain(m) <= eps)) {
    return ms.every((m: any) => (m.issuedQty ?? 0) <= eps) ? 'cancelled' : 'issued'
  }
  if (ms.some((m: any) => (m.issuedQty ?? 0) > eps) || ms.some((m: any) => (m.cancelledQty ?? 0) > eps)) return 'partial'
  return 'none'
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.receivableOrders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

function openDialog(row: any) {
  current.value = row
  form.quantity = remaining(row)
  form.unit = row.material?.unit || ''
  form.batchNo = ''
  form.closeWorkOrder = false
  form.warehouseId = warehouseIdByLocation(activeWarehouses.value, row.material?.location) || activeWarehouses.value[0]?.id || null
  form.effectiveDate = new Date().toISOString().slice(0, 10)
  form.handler = ''
  form.keeper = ''
  dialogVisible.value = true
  loadBins()
}

async function submit() {
  const qty = Number(form.quantity) || 0
  if (qty === 0) {
    ElMessage.warning('入库/退库数量不能为0')
    return
  }
  if (!form.warehouseId) {
    ElMessage.warning('请选择入库仓库')
    return
  }
  if (!unitRate.value) {
    ElMessage.warning(`单位「${form.unit}」未维护换算关系`)
    return
  }
  const baseQty = qty * unitRate.value
  const isReturn = baseQty < 0
  if (isReturn) {
    if (Math.abs(baseQty) > (Number(current.value?.receivedQty) || 0) + 1e-6) {
      ElMessage.warning(`退库数量超过已入库数量 ${current.value?.receivedQty ?? 0}`)
      return
    }
    try {
      await ElMessageBox.confirm(
        `将退库 ${Math.abs(qty)} ${form.unit || ''}（折算 ${Math.abs(baseQty)} ${productMaterial.value?.unit || ''}），扣减产品库存并回减已入库数量。是否继续？`,
        '退库确认',
        { type: 'warning', confirmButtonText: '确认退库', cancelButtonText: '返回修改' }
      )
    } catch {
      return
    }
  } else {
    if (baseQty > remaining(current.value) + 1e-6) {
      const remain = remaining(current.value)
      ElMessage.warning(
        remain <= 1e-6
          ? '该生产订单已全部入库，剩余可入库为 0；如需退库请输入负数'
          : `入库数量超过剩余可入库数量 ${remain}`
      )
      return
    }
    if (form.closeWorkOrder) {
      try {
        await ElMessageBox.confirm(
          `已勾选“入库后关闭生产订单”，提交后生产订单 ${current.value.orderNo} 将被关闭，不能再继续入库、报工或发料。是否继续？`,
          '关闭生产订单确认',
          { type: 'warning', confirmButtonText: '继续提交', cancelButtonText: '返回修改' }
        )
      } catch {
        return
      }
    }
  }
  submitting.value = true
  try {
    const res: any = await productionApi.receiveOrderProduct(current.value.id, {
      quantity: form.quantity,
      unit: form.unit || undefined,
      warehouseId: form.warehouseId,
      binId: binRequired.value ? form.binId : undefined,
      batchNo: form.batchNo || undefined,
      closeWorkOrder: isReturn ? undefined : form.closeWorkOrder || undefined,
      effectiveDate: form.effectiveDate || undefined,
      handler: form.handler || undefined,
      keeper: form.keeper || undefined,
    })
    if (isReturn) {
      ElMessage.success(`退库已提交，已入库数量回减至 ${res.data?.receivedQty ?? ''}`)
    } else if (res.data?.closed) {
      ElMessage.success('入库已提交，生产订单已关闭')
    } else if (res.data?.fullyReceived) {
      ElMessage.success('入库已提交，已全部入库；如需关闭订单请勾选「入库后关闭生产订单」后再次入库')
    } else {
      ElMessage.success('入库已提交')
    }
    dialogVisible.value = false
    loadData()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadWarehouses()
  await loadData()
  stockApi.handlers().then((r: any) => { handlerOptions.value = r.data || [] })
  stockApi.handlers('keeper').then((r: any) => { keeperOptions.value = r.data || [] })
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产入库（成品/半成品）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 170px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="list-summary">
        <span>可入库生产订单 <b>{{ total }}</b> 张</span>
        <span v-if="list.length">· 本页剩余待入库 <b>{{ list.reduce((s: number, r: any) => s + Math.max(0, remaining(r)), 0) }}</b></span>
        <span class="list-summary-tip">显示所有未关闭的生产订单（含已入满）；成品/半成品按生产订单入库</span>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 300px)">
        <el-table-column label="生产订单" width="150">
          <template #default="{ row }">{{ row.orderNo }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="plannedQty" label="计划数量" width="100" align="right" />
        <el-table-column prop="receivedQty" label="已入库" width="90" align="right" />
        <el-table-column label="剩余" width="90" align="right">
          <template #default="{ row }">{{ remaining(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="执行状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" round :type="execStatusType(row.execStatus)">{{ execStatusLabel(row.execStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发料状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="issueProgress(row)" size="small" :type="issueProgressOptions[issueProgress(row)!].type">
              {{ issueProgressOptions[issueProgress(row)!].label }}
            </el-tag>
            <span v-else style="color: var(--el-text-color-secondary)">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">入库</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有可入库的生产订单" :image-size="56">
            <div class="empty-tip">没有未关闭的生产订单；可清空订单号重试</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="生产入库/退库" width="480px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="生产订单">
          <span>{{ current?.orderNo }}</span>
        </el-form-item>
        <el-form-item label="产品">
          <span>{{ current?.material?.code }} - {{ current?.material?.name }}</span>
        </el-form-item>
        <el-form-item label="已入库">
          <span>{{ current?.receivedQty ?? 0 }} / {{ current?.plannedQty ?? 0 }}</span>
        </el-form-item>
        <el-form-item label="剩余可入库">
          <span>{{ current ? remaining(current) : 0 }}</span>
        </el-form-item>
        <el-form-item label="入库仓库" required>
          <el-select v-model="form.warehouseId" placeholder="选择仓库" style="width: 100%" @change="loadBins">
            <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="binRequired" label="货位">
          <el-select v-model="form.binId" filterable clearable placeholder="选择货位" style="width: 100%">
            <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="入库/退库数量" required>
          <el-input-number v-model="form.quantity" :precision="2" :controls="false" style="width: 100%" />
          <div class="unit-hint">正数入库，负数退库；退库最多 {{ current?.receivedQty ?? 0 }}（输入负数）</div>
          <div v-if="baseHint" class="unit-hint">{{ baseHint }}</div>
        </el-form-item>
        <el-form-item label="计量单位">
          <el-select v-model="form.unit" filterable allow-create default-first-option placeholder="默认基本单位" style="width: 100%">
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="批号">
          <el-input v-model="form.batchNo" placeholder="空则自动生成；退库时批号管理物料必填" />
        </el-form-item>
        <el-form-item label="生效日期">
          <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="选择生效日期" />
        </el-form-item>
        <el-form-item label="经手人">
          <el-select v-model="form.handler" filterable clearable allow-create default-first-option placeholder="选择或输入经手人" style="width: 100%">
            <el-option v-for="h in handlerOptions" :key="h" :label="h" :value="h" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓管员">
          <el-select v-model="form.keeper" filterable clearable allow-create default-first-option placeholder="选择或输入仓管员" style="width: 100%">
            <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="关闭订单">
          <el-checkbox v-model="form.closeWorkOrder" :disabled="Number(form.quantity) < 0">入库后关闭生产订单</el-checkbox>
          <div class="unit-hint">勾选后提交时会再次确认；退库不关闭订单；关闭后不能再入库、报工或发料</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.unit-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
