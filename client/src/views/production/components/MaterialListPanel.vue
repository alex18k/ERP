<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productionApi, materialApi } from '../../../api'

const props = withDefaults(defineProps<{ orderNo: string; order?: any; requireOrder?: boolean; showTitle?: boolean }>(), {
  order: null,
  requireOrder: false,
  showTitle: true,
})

const router = useRouter()

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20 })
let loadToken = 0

const statusOptions = [
  { label: '待领料', value: 'pending', type: 'info' },
  { label: '部分领料', value: 'partial', type: 'warning' },
  { label: '已领料', value: 'issued', type: 'success' },
  { label: '已取消未发', value: 'cancelled', type: 'info' },
]
function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label || s
}
function statusType(s: string) {
  return statusOptions.find((o) => o.value === s)?.type || 'info'
}

function orderStatusLabel(s: string) {
  const map: Record<string, string> = {
    planned: '已计划',
    in_progress: '已下达',
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

async function loadData() {
  const token = ++loadToken
  if (props.requireOrder && !props.orderNo) {
    list.value = []
    total.value = 0
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res: any = await productionApi.orderMaterials({ page: query.page, pageSize: query.pageSize, orderNo: props.orderNo })
    if (token !== loadToken) return
    list.value = res.data.items
    total.value = res.data.total
  } catch {
    if (token === loadToken) {
      list.value = []
      total.value = 0
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch(
  () => props.orderNo,
  () => {
    query.page = 1
    loadData()
  },
  { immediate: true }
)

function currentWorkOrder() {
  const order = props.order
  if (!order || order.execStatus === 'none') return null
  if (order.status === 'closed') return null
  return order
}

function isWorkOrderLocked(row: any) {
  const o = row.productionOrder
  return o?.status === 'closed'
}

function printOrder() {
  router.push({ path: '/production/work-order-material-print', query: { orderNo: props.orderNo } })
}

// ===== 新增/编辑物料行 =====
const editVisible = ref(false)
const isCreate = ref(false)
const saving = ref(false)
const formRef = ref()
const materials = ref<any[]>([])
const materialLoading = ref(false)

const form = reactive<any>({ id: null, productionOrderId: null, materialId: null, requiredQty: 1, unit: '', remark: '' })
const rules = {
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
  if (!props.order) {
    ElMessage.warning('请先选择生产订单')
    return
  }
  const wo = currentWorkOrder()
  if (!wo) {
    ElMessage.warning('该生产订单尚未排产或执行已关闭')
    return
  }
  isCreate.value = true
  Object.assign(form, {
    id: null,
    productionOrderId: wo.id,
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
    productionOrderId: row.productionOrderId,
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
      await productionApi.addOrderMaterial(form.productionOrderId, {
        materialId: form.materialId,
        requiredQty: Number(form.requiredQty),
        unit: form.unit || null,
        remark: form.remark || null,
      })
      ElMessage.success('物料行已添加')
    } else {
      await productionApi.updateOrderMaterial(form.id, {
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
    await productionApi.deleteOrderMaterial(row.id)
    ElMessage.success('物料行已删除')
    await loadData()
  } catch {
    /* error shown */
  }
}
</script>

<template>
  <div>
    <div class="table-toolbar">
      <span v-if="showTitle" class="toolbar-title">生产领料单（物料清单）</span>
      <div style="flex: 1" />
      <el-button type="primary" :disabled="!currentWorkOrder()" @click="openCreate"><el-icon><Plus /></el-icon>新增物料</el-button>
      <el-button type="success" :disabled="!order || order.execStatus === 'none'" @click="printOrder"><el-icon><Printer /></el-icon>打印领料单</el-button>
      <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 300px)">
      <el-table-column label="生产订单" min-width="150">
        <template #default="{ row }">{{ row.productionOrder?.orderNo }}</template>
      </el-table-column>
      <el-table-column label="生产订单状态" width="110">
        <template #default="{ row }">
          <el-tag :type="orderStatusType(row.productionOrder?.status)" size="small" effect="plain">{{ orderStatusLabel(row.productionOrder?.status) }}</el-tag>
        </template>
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
      <el-table-column prop="requiredQty" label="需求量" width="100" align="right" />
      <el-table-column prop="issuedQty" label="已领料" width="90" />
      <el-table-column prop="cancelledQty" label="已取消" width="90" />
      <el-table-column prop="unit" label="单位" width="70" />
      <el-table-column label="领料状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120">
        <template #default="{ row }">{{ row.remark || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" link :disabled="isWorkOrderLocked(row) || row.issuedQty > 0" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" link :disabled="isWorkOrderLocked(row) || row.issuedQty > 0" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="没有符合条件的物料清单" :image-size="56">
          <div class="empty-tip">{{ requireOrder && !orderNo ? '请先在上方选择生产订单' : '默认平铺显示所有已排产订单的物料清单；可先选生产订单查看' }}</div>
        </el-empty>
      </template>
    </el-table>

    <div class="pagination-wrap">
      <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
    </div>

    <el-dialog v-model="editVisible" :title="isCreate ? '新增物料行' : '编辑物料行'" width="560px" destroy-on-close>
      <el-descriptions v-if="order" :column="2" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ order.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ order.material?.code }} - {{ order.material?.name }}</el-descriptions-item>
      </el-descriptions>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="生产订单">
          <span>{{ order?.orderNo || '-' }}</span>
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
