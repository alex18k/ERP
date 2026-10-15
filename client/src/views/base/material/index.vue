<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { materialApi, supplierApi, warehouseApi, processRouteApi } from '../../../api'
import { MATERIAL_CATEGORIES, materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, code: '', name: '', materialType: '', status: 1 })

const categoryOptions = MATERIAL_CATEGORIES

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
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  query.page = 1
  loadData()
}

function handleReset() {
  query.code = ''
  query.name = ''
  query.materialType = ''
  query.status = 1
  query.page = 1
  loadData()
}

function formatCategory(val: string) {
  return materialCategoryLabel(val)
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
  name: '',
  specification: '',
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
  processRouteId: null,
  supplierId: null,
  batchManaged: false,
  location: '',
  remark: '',
})

const rules = {
  code: [{ required: true, message: '请输入物料编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入物料名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  unit: [{ required: true, message: '请输入单位', trigger: 'blur' }],
}

async function openDialog(row?: any) {
  await loadOptions()
  isEdit.value = !!row
  if (row) {
    Object.assign(form, row)
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
    form.processRouteId = null
    form.location = ''
    form.batchManaged = false
    form.status = 1
  }
  dialogVisible.value = true
}

async function loadOptions() {
  const [sRes, wRes, mRes, rRes, tRes] = await Promise.all([
    supplierApi.list({ pageSize: 200 }),
    warehouseApi.list({ pageSize: 200 }),
    materialApi.list({ pageSize: 1000 }),
    processRouteApi.list({ pageSize: 200 }),
    materialApi.types(),
  ])
  suppliers.value = sRes.data.items
  warehouses.value = wRes.data.items
  routes.value = rRes.data.items

  const units = new Set<string>()
  for (const m of mRes.data.items) {
    if (m.unit) units.add(m.unit)
  }
  const baseUnits = ['张', '个', '套', '台', '件', '只', '米', '千克', '吨', '升', '箱', '包', '卷']
  unitOptions.value = [...new Set([...baseUnits, ...units])]
  typeOptions.value = tRes.data || []

  locationOptions.value = warehouses.value.map((w: any) => ({ code: w.code, name: w.name }))
}

async function loadTypeOptions() {
  try {
    const res: any = await materialApi.types()
    typeOptions.value = res.data || []
  } catch { /* ignore */ }
}

async function handleSave() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const payload = { ...form }
  delete payload.id
  delete payload.createdAt
  delete payload.updatedAt
  delete payload.supplier
  delete payload.stock
  delete payload.processRoute

  if (isEdit.value) {
    await materialApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await materialApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除物料「${row.name}」吗？`, '提示', { type: 'warning' })
    await materialApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
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
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.code" placeholder="物料编码" clearable style="width: 180px" />
        <el-input v-model="query.name" placeholder="物料名称" clearable style="width: 180px" />
        <el-select v-model="query.materialType" placeholder="物料类别" clearable filterable :fit-input-width="false" style="width: 150px">
          <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
        </el-select>
        <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="handleReset">重置</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增物料</el-button>
        <el-button @click="handleRecalcCost">重算成本</el-button>
        <el-button @click="materialApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 250px)">
        <el-table-column prop="code" label="物料编码" width="110" />
        <el-table-column prop="name" label="物料名称" min-width="160" />
        <el-table-column prop="specification" label="规格型号" min-width="140" />
        <el-table-column prop="materialType" label="物料类别" min-width="110" />
        <el-table-column label="分类" width="90">
          <template #default="{ row }">
            {{ formatCategory(row.category) }}
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column prop="safetyStock" label="安全库存" width="90" />
        <el-table-column prop="leadTime" label="采购提前期" width="110" />
        <el-table-column prop="manufactureLeadTime" label="制造提前期" width="110" />
        <el-table-column prop="orderCycleDays" label="订货周期(天)" width="110" />
        <el-table-column prop="minOrderQty" label="最小订量" width="90" />
        <el-table-column prop="cost" label="成本" width="80" />
        <el-table-column label="当前库存" width="100">
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
        <el-table-column prop="createdAt" label="创建日期" width="150" :formatter="(row: any) => fmtDateTime(row.createdAt)" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="info" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
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
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑物料' : '新增物料'" width="800px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="物料编码" prop="code">
              <el-input v-model="form.code" placeholder="如 M-001" />
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
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="物料类别">
              <el-select v-model="form.materialType" filterable clearable placeholder="选择物料类别（在基础数据→物料类别维护中新增）" :fit-input-width="false" style="width: 100%">
                <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最小订量">
              <el-input-number v-model="form.minOrderQty" :min="0" style="width: 100%" />
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
              <el-input-number v-model="form.leadTime" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="制造提前期">
              <el-input-number v-model="form.manufactureLeadTime" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="订货周期(天)">
              <el-input-number v-model="form.orderCycleDays" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="成本">
              <el-input-number v-model="form.cost" :min="0" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="安全库存">
              <el-input-number v-model="form.safetyStock" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="最低库存">
              <el-input-number v-model="form.minStock" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="最高库存">
              <el-input-number v-model="form.maxStock" :min="0" style="width: 100%" />
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
            <el-form-item label="库位">
              <el-select v-model="form.location" clearable filterable placeholder="选择库位" style="width: 100%">
                <el-option v-for="l in locationOptions" :key="l.code" :label="l.name ? `${l.code} - ${l.name}` : l.code" :value="l.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="工艺路线">
          <el-select v-model="form.processRouteId" clearable filterable placeholder="选择该物料使用的工艺路线（成品/半成品）" style="width: 100%">
            <el-option v-for="r in routes" :key="r.id" :label="`${r.code} - ${r.name}`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>