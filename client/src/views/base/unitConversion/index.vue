<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { unitConversionApi, materialApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '' })

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({ id: null, materialId: null, basicUnit: '', unit: '', conversionRate: 1, remark: '' })

const materialOpts = ref<any[]>([])
const matLoading = ref(false)

const rules = {
  materialId: [{ required: true, message: '请选择物料', trigger: 'change' }],
  unit: [{ required: true, message: '请输入转换单位', trigger: 'blur' }],
  conversionRate: [{ required: true, message: '请输入换算率', trigger: 'blur' }],
}

function fmtRate(v: any) {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function relationText(row: any) {
  if (!row?.material?.unit) return '-'
  return `1 ${row.unit} = ${fmtRate(row.conversionRate)} ${row.material.unit}`
}

async function searchMaterials(keyword: string) {
  matLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword: (keyword || '').trim(), limit: 50 })
    materialOpts.value = res.data || []
  } catch {
    materialOpts.value = []
  } finally {
    matLoading.value = false
  }
}

function onMaterialChange(id: number) {
  const m = materialOpts.value.find((o) => o.id === id)
  form.basicUnit = m?.unit || ''
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await unitConversionApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function resetQuery() {
  query.keyword = ''
  query.page = 1
  loadData()
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) {
    Object.assign(form, {
      id: row.id,
      materialId: row.materialId,
      basicUnit: row.material?.unit || '',
      unit: row.unit,
      conversionRate: row.conversionRate,
      remark: row.remark || '',
    })
    materialOpts.value = row.material ? [row.material] : []
  } else {
    Object.assign(form, { id: null, materialId: null, basicUnit: '', unit: '', conversionRate: 1, remark: '' })
    searchMaterials('')
  }
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    materialId: form.materialId,
    unit: (form.unit || '').trim(),
    conversionRate: Number(form.conversionRate),
    remark: form.remark,
  }
  try {
    if (isEdit.value) {
      await unitConversionApi.update(form.id, payload)
      ElMessage.success('更新成功')
    } else {
      await unitConversionApi.create(payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch { /* 错误已由拦截器提示 */ }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除物料「${row.material?.name || ''}」的转换单位「${row.unit}」吗？`, '提示', { type: 'warning' })
    await unitConversionApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.keyword" placeholder="物料编码/名称/转换单位" clearable style="width: 220px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery"><el-icon><Refresh /></el-icon>重置</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增换算关系</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="物料编码" width="130">
          <template #default="{ row }">{{ row.material?.code || '-' }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="180">
          <template #default="{ row }">{{ row.material?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="基本单位" width="110" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ row.material?.unit || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="转换单位" width="120" align="center" />
        <el-table-column label="换算率" width="120" align="right">
          <template #default="{ row }">{{ fmtRate(row.conversionRate) }}</template>
        </el-table-column>
        <el-table-column label="换算关系" min-width="220">
          <template #default="{ row }">{{ relationText(row) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑换算关系' : '新增换算关系'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="物料" prop="materialId">
          <el-select
            v-model="form.materialId"
            filterable
            remote
            reserve-keyword
            :remote-method="searchMaterials"
            :loading="matLoading"
            placeholder="输入物料编码/名称搜索"
            style="width: 100%"
            @change="onMaterialChange"
          >
            <el-option v-for="m in materialOpts" :key="m.id" :label="`${m.code} ${m.name}`" :value="m.id">
              <span>{{ m.code }} {{ m.name }}</span>
              <span style="float: right; color: var(--el-text-color-secondary)">{{ m.specification || '' }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="基本单位">
          <el-input :model-value="form.basicUnit" readonly placeholder="选择物料后自动带出（物料主文件）" />
        </el-form-item>
        <el-form-item label="转换单位" prop="unit">
          <el-input v-model="form.unit" placeholder="如 箱 / 包 / 吨" />
        </el-form-item>
        <el-form-item label="换算率" prop="conversionRate">
          <el-input-number v-model="form.conversionRate" :min="0.000001" :precision="6" :step="1" controls-position="right" style="width: 220px" />
          <span class="rate-hint">1 转换单位 = 换算率 × 基本单位</span>
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

<style scoped>
.rate-hint {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
