<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, materialApi } from '../../../api'

const router = useRouter()

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', materialKeyword: '' })

const statusOptions = [
  { label: '待领料', value: 'pending', type: 'info' },
  { label: '部分领料', value: 'partial', type: 'warning' },
  { label: '已领料', value: 'issued', type: 'success' },
]
function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label || s
}
function statusType(s: string) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

async function loadData() {
  if (!query.orderNo) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res: any = await productionApi.batchMaterials(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

const currentOrder = ref<any>(null)

async function loadCurrentOrder(orderNo: string) {
  const cached = [...orderOptionMap.values()].find((o) => o.orderNo === orderNo)
  if (cached) {
    currentOrder.value = cached
    return
  }
  try {
    const res: any = await productionApi.orders({ pageSize: 5, orderNo })
    currentOrder.value = res.data.items?.[0] || null
  } catch {
    currentOrder.value = null
  }
}

async function onOrderChange() {
  query.page = 1
  if (!query.orderNo) {
    currentOrder.value = null
    await loadData()
    return
  }
  await loadCurrentOrder(query.orderNo)
  await loadData()
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  return String(d).slice(0, 10)
}

function orderStatusLabel(s: string) {
  const map: Record<string, string> = {
    planned: '已计划',
    in_progress: '生产中',
    completed: '已完成',
    cancelled: '已取消',
    released: '已下达',
  }
  return map[s] || s
}

function orderStatusType(s: string) {
  const map: Record<string, string> = {
    planned: 'info',
    in_progress: 'primary',
    completed: 'success',
    cancelled: 'danger',
    released: 'warning',
  }
  return map[s] || 'info'
}

function activeBatches(batches: any[] = []) {
  return batches.filter((b: any) => b.status !== 'cancelled')
}

// ===== 新增/编辑物料行 =====
const editVisible = ref(false)
const isCreate = ref(false)
const saving = ref(false)
const formRef = ref()
const materials = ref<any[]>([])
const materialLoading = ref(false)

// ===== 生产订单下拉 =====
const orderOptionsLoading = ref(false)
const orderOptions = ref<any[]>([])
const orderOptionMap = new Map<number, any>()

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

function clearQuery() {
  Object.assign(query, { orderNo: '', materialKeyword: '', page: 1 })
  currentOrder.value = null
  loadData()
}
const form = reactive<any>({ id: null, batchId: null, materialId: null, requiredQty: 1, unit: '', remark: '' })
const rules = {
  batchId: [{ required: true, message: '请选择批次', trigger: 'change' }],
  materialId: [{ required: true, message: '请选择物料', trigger: 'change' }],
  requiredQty: [{ required: true, message: '请输入需求量', trigger: 'blur' }],
}

async function searchMaterials(keyword: string) {
  materialLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword, limit: 50 })
    materials.value = res.data || []
  } catch {
    /* ignore */
  } finally {
    materialLoading.value = false
  }
}

function openCreate() {
  if (!currentOrder.value) {
    ElMessage.warning('请先选择生产订单')
    return
  }
  const batches = activeBatches(currentOrder.value.batches)
  if (batches.length === 0) {
    ElMessage.warning('该生产订单无有效批次')
    return
  }
  isCreate.value = true
  Object.assign(form, {
    id: null,
    batchId: batches[0].id,
    materialId: null,
    requiredQty: 1,
    unit: '',
    remark: '',
  })
  materials.value = []
  editVisible.value = true
}

function openEdit(row: any) {
  isCreate.value = false
  Object.assign(form, {
    id: row.id,
    batchId: row.batchId,
    materialId: row.materialId,
    requiredQty: row.requiredQty,
    unit: row.unit || row.material?.unit || '',
    remark: row.remark || '',
  })
  materials.value = [row.material].filter(Boolean)
  editVisible.value = true
}

function onMaterialChange() {
  const m = materials.value.find((x) => x.id === form.materialId)
  if (m?.unit) form.unit = form.unit || m.unit
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  saving.value = true
  try {
    if (isCreate.value) {
      await productionApi.addBatchMaterial(form.batchId, {
        materialId: form.materialId,
        requiredQty: Number(form.requiredQty),
        unit: form.unit || null,
        remark: form.remark || null,
      })
      ElMessage.success('物料行已添加')
    } else {
      await productionApi.updateBatchMaterial(form.id, {
        materialId: form.materialId,
        requiredQty: Number(form.requiredQty),
        unit: form.unit || null,
        remark: form.remark || null,
      })
      ElMessage.success('物料行已更新')
    }
    editVisible.value = false
    await loadData()
  } catch {
    /* error shown */
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除物料行「${row.material?.code} - ${row.material?.name}」？`, '删除确认', { type: 'warning' })
  } catch { return }
  try {
    await productionApi.deleteBatchMaterial(row.id)
    ElMessage.success('物料行已删除')
    await loadData()
  } catch {
    /* error shown */
  }
}

onMounted(async () => {
  await loadOrderOptions()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">加工单物料清单</span>
        <div style="flex: 1" />
        <el-button type="primary" :disabled="!currentOrder" @click="openCreate"><el-icon><Plus /></el-icon>新增物料</el-button>
        <el-button type="success" :disabled="!currentOrder" @click="router.push({ path: '/production/batch-material-print', query: { orderNo: currentOrder?.orderNo } })"><el-icon><Printer /></el-icon>打印领料单</el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="search-bar">
        <el-select v-model="query.orderNo" filterable remote clearable reserve-keyword :remote-method="loadOrderOptions" :loading="orderOptionsLoading" placeholder="选择生产订单" style="width: 280px" @change="onOrderChange">
          <el-option v-for="o in orderOptions" :key="o.id" :label="`${o.orderNo}${o.material ? '（' + o.material.name + '）' : ''}`" :value="o.orderNo" />
        </el-select>
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="clearQuery">重置</el-button>
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
            <span class="order-info-label">批次</span>
            <span>{{ activeBatches(currentOrder.batches).length }} 批</span>
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

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="生产订单" min-width="150">
          <template #default="{ row }">{{ row.batch?.productionOrder?.orderNo }}</template>
        </el-table-column>
        <el-table-column label="批次" width="90">
          <template #default="{ row }">第{{ row.batch?.batchNo }}批（{{ row.batch?.quantity }}）</template>
        </el-table-column>
        <el-table-column label="物料编码" width="120">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="160">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120">
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column prop="requiredQty" label="需求量" width="100" />
        <el-table-column prop="issuedQty" label="已领料" width="90" />
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120">
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link :disabled="row.issuedQty > 0" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" link :disabled="row.issuedQty > 0" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="editVisible" :title="isCreate ? '新增物料行' : '编辑物料行'" width="560px" destroy-on-close>
      <el-descriptions v-if="currentOrder" :column="2" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ currentOrder.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ currentOrder.material?.code }} - {{ currentOrder.material?.name }}</el-descriptions-item>
      </el-descriptions>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="批次" prop="batchId">
          <el-select v-model="form.batchId" filterable style="width: 100%" :disabled="!isCreate">
            <el-option v-for="b in activeBatches(currentOrder?.batches)" :key="b.id" :label="`第${b.batchNo}批（${b.quantity}）`" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="物料" prop="materialId">
          <el-select v-model="form.materialId" filterable remote reserve-keyword :remote-method="searchMaterials" :loading="materialLoading" placeholder="输入编码/名称搜索物料" @change="onMaterialChange" style="width: 100%">
            <el-option v-for="m in materials" :key="m.id" :label="`${m.code} - ${m.name}${m.specification ? ' / ' + m.specification : ''}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="需求量" prop="requiredQty">
          <el-input-number v-model="form.requiredQty" :min="0.01" :precision="2" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="form.unit" placeholder="自动带出，可改" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
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
</style>