<script setup lang="ts">
import { h, ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { materialApi, supplierApi, warehouseApi, processRouteApi } from '../../../api'
import { MATERIAL_CATEGORIES, materialCategoryLabel } from '../../../utils/category'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import { createEmptyCondition, serializeConditions, type QueryCondition, type QueryField } from '../../../utils/queryBuilder'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const tableRef = ref()
const currentRow = ref<any>(null)
const query = reactive({ page: 1, pageSize: 20, conditions: undefined as string | undefined })

const categoryOptions = MATERIAL_CATEGORIES

// ===== 高级查询 =====
const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])

const queryFields: QueryField[] = [
  { field: 'code', label: '物料编码', type: 'text', placeholder: '物料编码' },
  { field: 'bomcode', label: 'BOM编码', type: 'text', placeholder: 'BOM编码' },
  { field: 'name', label: '物料名称', type: 'text', placeholder: '物料名称' },
  { field: 'specification', label: '规格型号', type: 'text', placeholder: '规格型号' },
  { field: 'description', label: '物料描述', type: 'text', placeholder: '物料描述' },
  { field: 'packageType', label: '封装', type: 'text', placeholder: '封装' },
  { field: 'brand', label: '品牌', type: 'text', placeholder: '品牌' },
  { field: 'materialType', label: '物料类别', type: 'text', placeholder: '物料类别' },
  {
    field: 'category',
    label: '分类',
    type: 'enum',
    options: [
      { label: '采购', value: 'purchase' },
      { label: '制造', value: 'manufacture' },
    ],
  },
  { field: 'unit', label: '计量单位', type: 'text', placeholder: '单位' },
  {
    field: 'batchManaged',
    label: '批号管理',
    type: 'enum',
    options: [
      { label: '是', value: '1' },
      { label: '否', value: '0' },
    ],
  },
  { field: 'safetyStock', label: '安全库存', type: 'number' },
  { field: 'minStock', label: '最低库存', type: 'number' },
  { field: 'maxStock', label: '最高库存', type: 'number' },
  { field: 'leadTime', label: '采购提前期', type: 'number' },
  { field: 'manufactureLeadTime', label: '制造提前期', type: 'number' },
  { field: 'orderCycleDays', label: '订货周期(天)', type: 'number' },
  { field: 'minOrderQty', label: '最小订量', type: 'number' },
  { field: 'cost', label: '成本(加权平均)', type: 'number' },
  { field: 'price', label: '最近采购价', type: 'number' },
  { field: 'location', label: '库位', type: 'text', placeholder: '库位' },
  { field: 'supplierName', label: '主要供应商', type: 'text', placeholder: '供应商名称' },
  { field: 'routeName', label: '工艺路线', type: 'text', placeholder: '工艺路线名称' },
  {
    field: 'status',
    label: '状态',
    type: 'enum',
    options: [
      { label: '启用', value: 1 },
      { label: '停用', value: 0 },
    ],
  },
  { field: 'remark', label: '备注', type: 'text', placeholder: '备注' },
  { field: 'createdAt', label: '创建日期', type: 'date' },
]

function fmtDateTime(v?: string | Date | null) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await materialApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
    currentRow.value = null
    tableRef.value?.setCurrentRow()
  } finally {
    loading.value = false
  }
}

function submitAdvanced(conditions: QueryCondition[]) {
  query.conditions = serializeConditions(conditions)
  query.page = 1
  loadData()
}

function resetAdvanced() {
  advancedConditions.value = [createEmptyCondition()]
  query.conditions = undefined
  query.page = 1
  loadData()
}

function formatCategory(val: string) {
  return materialCategoryLabel(val)
}

function categoryTagType(val: string) {
  if (val === 'purchase') return 'success'
  if (val === 'manufacture') return 'primary'
  return 'info'
}

// ===== 新增/编辑 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const suppliers = ref<any[]>([])
const warehouses = ref<any[]>([])
const routes = ref<any[]>([])
const unitOptions = ref<string[]>([])
const locationOptions = ref<{ code: string; name: string }[]>([])
const typeOptions = ref<string[]>([])
const form = reactive<any>({
  id: null,
  code: '',
  bomcode: '',
  name: '',
  specification: '',
  description: '',
  packageType: '',
  brand: '',
  category: 'purchase',
  materialType: '',
  unit: '',
  safetyStock: 0,
  minStock: 0,
  maxStock: 0,
  leadTime: 0,
  manufactureLeadTime: 0,
  orderCycleDays: 30,
  minOrderQty: 0,
  cost: 0,
  price: 0,
  processRouteId: null,
  supplierId: null,
  batchManaged: false,
  location: '',
  status: 1,
  remark: '',
})
let initialSnapshot = ''

const rules = {
  code: [{ required: true, message: '请输入物料编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入物料名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  unit: [{ required: true, message: '请输入单位', trigger: 'blur' }],
  materialType: [{ required: true, message: '请选择物料类别', trigger: 'change' }],
  location: [{ required: true, message: '请选择库位', trigger: 'change' }],
}

async function openDialog(row?: any, copy = false) {
  ensureOptions()
  isEdit.value = !!row && !copy
  if (row) {
    Object.assign(form, row)
    if (copy) {
      form.id = null
      form.code = `${row.code}-copy`
      form.status = 1
    }
  } else {
    Object.keys(form).forEach((k) => { form[k] = null })
    form.category = 'purchase'
    form.materialType = ''
    form.safetyStock = 0
    form.minStock = 0
    form.maxStock = 0
    form.leadTime = 0
    form.manufactureLeadTime = 0
    form.orderCycleDays = 30
    form.minOrderQty = 0
    form.cost = 0
    form.price = 0
    form.processRouteId = null
    form.location = ''
    form.batchManaged = false
    form.status = 1
  }
  initialSnapshot = JSON.stringify(buildPayload())
  dialogVisible.value = true
}

function buildPayload() {
  const payload: any = { ...form }
  delete payload.id
  delete payload.createdAt
  delete payload.updatedAt
  delete payload.supplier
  delete payload.stock
  delete payload.processRoute
  delete payload.desc1
  delete payload.desc2
  delete payload.desc3
  delete payload.desc4
  return payload
}

function isDirty() {
  return JSON.stringify(buildPayload()) !== initialSnapshot
}

// 选项数据（供应商/仓库/单位/工艺路线/物料类别）只加载一次：首次打开后台拉取，不阻塞弹窗
const optionsLoaded = ref(false)
let optionsLoading: Promise<void> | null = null

function ensureOptions(): Promise<void> {
  if (optionsLoaded.value) return Promise.resolve()
  if (!optionsLoading) {
    optionsLoading = loadOptions()
      .catch(() => { /* 失败不阻塞弹窗，下次打开再试 */ })
      .finally(() => { optionsLoading = null })
  }
  return optionsLoading
}

async function loadOptions() {
  const [sRes, wRes, uRes, rRes, tRes] = await Promise.all([
    supplierApi.list({ pageSize: 200 }),
    warehouseApi.list({ pageSize: 200 }),
    materialApi.units(),
    processRouteApi.list({ pageSize: 200 }),
    materialApi.types(),
  ])
  suppliers.value = sRes.data.items
  warehouses.value = wRes.data.items
  routes.value = rRes.data.items

  const baseUnits = ['张', '个', '套', '台', '件', '只', '米', '千克', '吨', '升', '箱', '包', '卷']
  unitOptions.value = [...new Set([...baseUnits, ...((uRes.data as string[]) || [])])]
  typeOptions.value = tRes.data || []

  locationOptions.value = warehouses.value.map((w: any) => ({ code: w.code, name: w.name }))
  optionsLoaded.value = true
}

async function loadTypeOptions() {
  try {
    const res: any = await materialApi.types()
    typeOptions.value = res.data || []
  } catch { /* ignore */ }
}

async function handleSave(): Promise<boolean> {
  try {
    await formRef.value.validate()
  } catch {
    return false
  }
  const payload = buildPayload()

  if (isEdit.value) {
    await materialApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await materialApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
  return true
}

function confirmLeave(done?: () => void) {
  const close = () => {
    if (done) done()
    else dialogVisible.value = false
  }
  if (!isDirty()) {
    close()
    return
  }
  ElMessageBox.confirm('当前物料尚未保存，是否保存后关闭？', '未保存的修改', {
    confirmButtonText: '保存',
    cancelButtonText: '不保存',
    distinguishCancelAndClose: true,
    type: 'warning',
  })
    .then(async () => {
      try {
        if (await handleSave()) close()
      } catch { /* error shown by interceptor */ }
    })
    .catch((action: string) => {
      if (action === 'cancel') close()
    })
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      h('div', [
        h('div', '确定删除以下物料吗？'),
        h('div', `物料编码：${row.code}`),
        h('div', `物料名称：${row.name}`),
        h('div', `规格型号：${row.specification || '-'}`),
      ]),
      '删除物料',
      { type: 'warning' },
    )
    await materialApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
}

function handleCurrentChange(row: any) {
  currentRow.value = row
}

function handleEditCurrent() {
  if (!currentRow.value) return ElMessage.warning('请先点击选择一行')
  openDialog(currentRow.value)
}

function handleCopyCurrent() {
  if (!currentRow.value) return ElMessage.warning('请先点击选择一行')
  openDialog(currentRow.value, true)
}

function handleDeleteCurrent() {
  if (!currentRow.value) return ElMessage.warning('请先点击选择一行')
  handleDelete(currentRow.value)
}

async function handleRecalcCost() {
  try {
    await ElMessageBox.confirm('将按 BOM 子件成本重算所有制造件成本，确定继续？', '重算成本', { type: 'warning' })
  } catch { return }
  try {
    const res: any = await materialApi.recalcCost()
    ElMessage.success(res.message || `已重算 ${res.data?.updated ?? 0} 个制造件成本`)
    loadData()
  } catch { /* error shown */ }
}

onMounted(() => {
  loadData()
  loadTypeOptions()
  // 预取表单下拉选项，首次点「新增物料」即可立即展示
  ensureOptions()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <div class="advanced-actions">
        <el-button type="success" plain @click="openDialog()"><el-icon><Plus /></el-icon>新增物料</el-button>
        <el-button @click="handleEditCurrent"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button @click="handleCopyCurrent"><el-icon><CopyDocument /></el-icon>复制</el-button>
        <el-button @click="handleDeleteCurrent"><el-icon><Delete /></el-icon>删除</el-button>
        <el-button @click="handleRecalcCost">重算成本</el-button>
        <el-button @click="materialApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table
        ref="tableRef"
        :data="list"
        v-loading="loading"
        stripe
        highlight-current-row
        max-height="calc(100vh - 250px)"
        @current-change="handleCurrentChange"
      >
        <el-table-column prop="code" label="物料编码" width="110" />
        <el-table-column prop="name" label="物料名称" min-width="160" />
        <el-table-column prop="specification" label="规格型号" min-width="140" />
        <el-table-column prop="description" label="物料描述" min-width="180" show-overflow-tooltip />
        <el-table-column prop="packageType" label="封装" width="100" />
        <el-table-column prop="brand" label="品牌" width="110" />
        <el-table-column prop="materialType" label="物料类别" min-width="110" />
        <el-table-column label="分类" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.category" :type="categoryTagType(row.category)" size="small" round>{{ formatCategory(row.category) }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column label="批号管理" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.batchManaged" type="warning" size="small">是</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="safetyStock" label="安全库存" width="90" align="right" />
        <el-table-column prop="minStock" label="最低库存" width="90" align="right" />
        <el-table-column prop="maxStock" label="最高库存" width="90" align="right" />
        <el-table-column prop="leadTime" label="采购提前期" width="110" align="right" />
        <el-table-column prop="manufactureLeadTime" label="制造提前期" width="110" align="right" />
        <el-table-column prop="orderCycleDays" label="订货周期(天)" width="110" align="right" />
        <el-table-column prop="minOrderQty" label="最小订量" width="90" align="right" />
        <el-table-column prop="cost" label="成本(加权平均)" width="120" align="right" />
        <el-table-column prop="price" label="最近采购价" width="100" align="right" />
        <el-table-column label="当前库存" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'text-overdue': row.stock && row.safetyStock > 0 && row.stock.quantity <= row.safetyStock }">
              {{ row.stock?.quantity ?? 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="supplier?.name" label="主要供应商" min-width="130" />
        <el-table-column prop="location" label="库位" width="100" />
        <el-table-column label="工艺路线" min-width="140">
          <template #default="{ row }">
            <span v-if="row.processRoute">{{ row.processRoute.code }} - {{ row.processRoute.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="bomcode" label="BOM编码" width="120" />
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建日期" width="150" :formatter="(row: any) => fmtDateTime(row.createdAt)" />
        <template #empty>
          <el-empty description="没有符合条件的物料" :image-size="56">
            <div class="empty-tip">试试更短的关键词，或清空编码/名称/封装等条件后重新查询</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑物料' : '新增物料'" width="800px" destroy-on-close :close-on-click-modal="false" :before-close="confirmLeave">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="物料编码" prop="code">
              <el-input v-model="form.code" :disabled="isEdit" placeholder="如 M-001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="物料名称" prop="name">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="规格型号">
              <el-input v-model="form.specification" placeholder="如 2mm×1000×2000" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类" prop="category">
              <el-select v-model="form.category" style="width: 100%">
                <el-option v-for="o in categoryOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="物料描述">
          <el-input v-model="form.description" placeholder="物料描述/补充说明" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="封装">
              <el-input v-model="form.packageType" placeholder="如 0603 / 1206 / QFN" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌">
              <el-input v-model="form.brand" placeholder="如 国巨 / 村田 / TI" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="物料类别" prop="materialType">
              <el-select v-model="form.materialType" filterable placeholder="选择物料类别（在基础数据→物料类别维护中新增）" :fit-input-width="false" style="width: 100%">
                <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最小订量">
              <el-input-number v-model="form.minOrderQty" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="计量单位" prop="unit">
              <el-select v-model="form.unit" filterable allow-create default-first-option placeholder="选择或输入单位" style="width: 100%">
                <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="批号管理">
              <el-switch v-model="form.batchManaged" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="采购提前期">
              <el-input-number v-model="form.leadTime" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="制造提前期">
              <el-input-number v-model="form.manufactureLeadTime" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="订货周期(天)">
              <el-input-number v-model="form.orderCycleDays" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="成本(加权平均)">
              <el-input-number v-model="form.cost" :min="0" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="最近采购价">
              <el-input-number v-model="form.price" :min="0" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="安全库存">
              <el-input-number v-model="form.safetyStock" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="最低库存">
              <el-input-number v-model="form.minStock" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="最高库存">
              <el-input-number v-model="form.maxStock" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="主要供应商">
              <el-select v-model="form.supplierId" clearable filterable style="width: 100%">
                <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库位" prop="location">
              <el-select v-model="form.location" filterable placeholder="选择库位" style="width: 100%">
                <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="BOM编码">
              <el-input v-model="form.bomcode" placeholder="用于管理BOM" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工艺路线">
              <el-select v-model="form.processRouteId" clearable filterable placeholder="选择该物料使用的工艺路线（成品/半成品）" style="width: 100%">
                <el-option v-for="r in routes" :key="r.id" :label="`${r.code} - ${r.name}`" :value="r.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmLeave()">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.advanced-query {
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid #d5dae2;
  border-radius: 6px;
  background: #fafbfc;
}
/* 与生产订单页查询框同高：去掉组件内额外上下留白 */
.advanced-query :deep(.query-builder) {
  padding: 0;
}
.advanced-query :deep(.query-row) {
  margin-bottom: 0;
}
.advanced-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
}
</style>
