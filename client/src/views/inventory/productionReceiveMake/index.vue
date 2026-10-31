<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, warehouseApi, warehouseBinApi, stockApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const submitting = ref(false)
const warehouses = ref<any[]>([])
const bins = ref<any[]>([])
const handlerOptions = ref<string[]>([])
const keeperOptions = ref<string[]>([])
const order = ref<any>(null)

const form = reactive<any>({
  quantity: 0,
  unit: '',
  warehouseId: null,
  binId: null,
  batchNo: '',
  effectiveDate: '',
  handler: '',
  keeper: '',
  remark: '',
  closeWorkOrder: false,
})

const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const selectedWarehouse = computed(() => warehouses.value.find((w: any) => w.id === form.warehouseId) || null)
const binRequired = computed(() => selectedWarehouse.value?.binManaged === true)

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function backToList() {
  router.replace({ name: 'InventoryProductionReceive' })
}

function remaining(row?: any) {
  const r = row || order.value
  if (!r) return 0
  return (r.plannedQty ?? 0) - (r.receivedQty ?? 0)
}

async function loadBins() {
  form.binId = null
  bins.value = []
  const wh = selectedWarehouse.value
  if (!wh?.binManaged) return
  const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
  bins.value = res.data.items
}

// 入库计量单位（产品基本单位 + 转换单位）与换算提示
const productMaterial = computed(() => order.value?.material || null)
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

async function loadPage() {
  const id = Number(route.query.orderId)
  if (!Number.isInteger(id) || id <= 0) {
    ElMessage.warning('缺少生产订单参数')
    backToList()
    return
  }
  loading.value = true
  try {
    const [wRes, oRes]: any[] = await Promise.all([
      warehouseApi.list({ pageSize: 200 }),
      productionApi.receivableOrders({ id, pageSize: 1 }),
    ])
    warehouses.value = wRes?.data?.items || []
    const data = (oRes?.data?.items || [])[0]
    if (!data) {
      ElMessage.warning('生产订单不存在或已关闭')
      backToList()
      return
    }
    order.value = data
    form.quantity = remaining(data)
    form.unit = data.material?.unit || ''
    form.batchNo = ''
    form.closeWorkOrder = false
    form.effectiveDate = todayStr()
    form.handler = ''
    form.keeper = ''
    form.remark = ''
    form.warehouseId = warehouseIdByLocation(activeWarehouses.value, data.material?.location) || activeWarehouses.value[0]?.id || null
    await loadBins()
    stockApi.handlers().then((r: any) => { handlerOptions.value = r.data || [] }).catch(() => {})
    stockApi.handlers('keeper').then((r: any) => { keeperOptions.value = r.data || [] }).catch(() => {})
  } catch (e: any) {
    ElMessage.warning(e?.response?.data?.message || '生产订单不存在或已关闭')
    backToList()
  } finally {
    loading.value = false
  }
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
    if (Math.abs(baseQty) > (Number(order.value?.receivedQty) || 0) + 1e-6) {
      ElMessage.warning(`退库数量超过已入库数量 ${order.value?.receivedQty ?? 0}`)
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
    if (baseQty > remaining() + 1e-6) {
      const remain = remaining()
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
          `已勾选“入库后关闭生产订单”，提交后生产订单 ${order.value.orderNo} 将被关闭，不能再继续入库、报工或发料。是否继续？`,
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
    const res: any = await productionApi.receiveOrderProduct(order.value.id, {
      quantity: form.quantity,
      unit: form.unit || undefined,
      warehouseId: form.warehouseId,
      binId: binRequired.value ? form.binId : undefined,
      batchNo: form.batchNo || undefined,
      closeWorkOrder: isReturn ? undefined : form.closeWorkOrder || undefined,
      effectiveDate: form.effectiveDate || undefined,
      handler: form.handler || undefined,
      keeper: form.keeper || undefined,
      remark: form.remark || undefined,
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
    backToList()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

onMounted(loadPage)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">生产入库/退库</span>
        <el-button style="margin-left: 12px" @click="backToList"><el-icon><Back /></el-icon>返回</el-button>
        <div style="flex: 1" />
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </div>

      <div class="erp-group">
        <div class="erp-group-title">生产订单</div>
        <el-descriptions :column="4" :border="false" size="small">
          <el-descriptions-item label="生产订单">{{ order?.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="产品">{{ order?.material?.code }} - {{ order?.material?.name }}</el-descriptions-item>
          <el-descriptions-item label="已入库 / 计划">{{ order?.receivedQty ?? 0 }} / {{ order?.plannedQty ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="剩余可入库">{{ remaining() }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <el-form :model="form" label-width="100px" class="kd-header-form">
        <div class="erp-group">
          <div class="erp-group-title">入库信息</div>
          <div class="kd-grid">
            <div class="kd-field">
              <el-form-item label="入库仓库" required>
                <el-select v-model="form.warehouseId" placeholder="选择仓库" class="kd-flex" @change="loadBins">
                  <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
                </el-select>
              </el-form-item>
            </div>
            <div v-if="binRequired" class="kd-field">
              <el-form-item label="货位">
                <el-select v-model="form.binId" filterable clearable placeholder="选择货位" class="kd-flex">
                  <el-option v-for="b in bins" :key="b.id" :label="`${b.code} - ${b.name}`" :value="b.id" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="入库/退库数量" required>
                <el-input-number v-model="form.quantity" :precision="2" :controls="false" class="kd-flex" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="计量单位">
                <el-select v-model="form.unit" filterable allow-create default-first-option placeholder="默认基本单位" class="kd-flex">
                  <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="批号">
                <el-input v-model="form.batchNo" placeholder="空则自动生成；退库时批管物料必填" class="kd-flex" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="生效日期">
                <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" placeholder="选择生效日期" class="kd-flex" />
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="经手人">
                <el-select v-model="form.handler" filterable clearable allow-create default-first-option placeholder="选择或输入经手人" class="kd-flex">
                  <el-option v-for="h in handlerOptions" :key="h" :label="h" :value="h" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field">
              <el-form-item label="仓管员">
                <el-select v-model="form.keeper" filterable clearable allow-create default-first-option placeholder="选择或输入仓管员" class="kd-flex">
                  <el-option v-for="k in keeperOptions" :key="k" :label="k" :value="k" />
                </el-select>
              </el-form-item>
            </div>
            <div class="kd-field kd-field-remark">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" placeholder="备注（可选）；不填则库存流水备注为空" class="kd-flex" />
              </el-form-item>
            </div>
            <div class="kd-field kd-field-span2">
              <el-form-item label="关闭订单">
                <el-checkbox v-model="form.closeWorkOrder" :disabled="Number(form.quantity) < 0">入库后关闭生产订单</el-checkbox>
              </el-form-item>
            </div>
          </div>
          <div class="unit-hint">正数入库，负数退库；退库最多 {{ order?.receivedQty ?? 0 }}（输入负数）；勾选「关闭订单」提交时会再次确认，退库不关闭订单。</div>
          <div v-if="baseHint" class="unit-hint">{{ baseHint }}</div>
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.erp-group {
  border: 1px solid #d5dae2;
  border-radius: 6px;
  padding: 8px 12px 2px;
  margin-bottom: 12px;
  background: #fafbfc;
}
.erp-group-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

/* 金蝶表头：5 列网格，固定标签宽，列对齐、行距紧凑 */
.kd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  column-gap: 16px;
  row-gap: 2px;
}
.kd-field-span2 { grid-column: span 2; }
.kd-field-remark { grid-column: 1 / -1; }
.kd-header-form .kd-grid :deep(.el-form-item) {
  margin-bottom: 6px;
  margin-right: 0;
  white-space: nowrap;
}
.kd-header-form .kd-grid :deep(.el-form-item__label) {
  line-height: 26px;
  height: 26px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.kd-header-form .kd-grid :deep(.el-form-item__content) {
  line-height: 26px;
  min-height: 26px;
  white-space: nowrap;
  min-width: 0;
}
.kd-flex {
  width: 100%;
}
.unit-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 2px 0 8px;
  line-height: 1.4;
}
</style>
