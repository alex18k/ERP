<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { systemApi } from '../../../api'
import { setCompanyInfo } from '../../../composables/useCompanyInfo'

const loading = ref(false)
const saving = ref(false)
const list = ref<any[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref()

const form = reactive<any>({
  nameZh: '',
  nameEn: '',
  region: '',
  contact: '',
  phone: '',
  fax: '',
  email: '',
  address: '',
  taxNo: '',
  website: '',
  remark: '',
})

const rules = {
  nameZh: [{ required: true, message: '请输入公司中文名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await systemApi.companies()
    list.value = res.data || []
    const def = list.value.find((c: any) => c.isDefault)
    if (def) setCompanyInfo(def)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  for (const key of Object.keys(form)) form[key] = ''
  dialogVisible.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  for (const key of Object.keys(form)) form[key] = row[key] || ''
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  saving.value = true
  try {
    const payload: any = {}
    for (const key of Object.keys(form)) payload[key] = form[key]
    if (editingId.value == null) {
      await systemApi.createCompany(payload)
    } else {
      await systemApi.updateCompanyById(editingId.value, payload)
    }
    dialogVisible.value = false
    ElMessage.success('公司信息保存成功')
    loadData()
  } catch { /* 错误已由拦截器提示 */ } finally {
    saving.value = false
  }
}

async function handleSetDefault(row: any) {
  try {
    await ElMessageBox.confirm(`确定将「${row.nameZh}」设为默认公司吗？其它页面将显示该公司名称。`, '设为默认')
  } catch { return }
  await systemApi.setDefaultCompany(row.id)
  ElMessage.success('默认公司已更新')
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除公司「${row.nameZh}」吗？`, '删除公司', { type: 'warning' })
  } catch { return }
  await systemApi.deleteCompany(row.id)
  ElMessage.success('公司删除成功')
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">公司信息维护</span>
        <el-button type="success" plain class="btn-add" style="margin-left: auto" @click="openCreate"><el-icon><Plus /></el-icon>新增公司</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="公司名称（中文）" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.nameZh }}</span>
            <el-tag v-if="row.isDefault" size="small" type="success" style="margin-left: 8px">默认</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="公司名称（英文）" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.nameEn || '-' }}</template>
        </el-table-column>
        <el-table-column label="联系人" width="120">
          <template #default="{ row }">{{ row.contact || '-' }}</template>
        </el-table-column>
        <el-table-column label="电话" width="150">
          <template #default="{ row }">{{ row.phone || '-' }}</template>
        </el-table-column>
        <el-table-column label="税号" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.taxNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="地址" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.address || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="primary" plain :disabled="row.isDefault" @click="handleSetDefault(row)">设为默认</el-button>
            <el-button size="small" type="danger" plain :disabled="row.isDefault || row.defaultedAt" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无公司" :image-size="56" />
        </template>
      </el-table>
    </div>
  </div>

  <el-dialog v-model="dialogVisible" :title="editingId == null ? '新增公司' : '编辑公司信息'" width="860px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="130px">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="公司名称（中文）" prop="nameZh">
            <el-input v-model="form.nameZh" placeholder="请输入公司中文名称" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="公司名称（英文）">
            <el-input v-model="form.nameEn" placeholder="Company Name (English)" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="地区">
            <el-input v-model="form.region" placeholder="如 广东省肇庆市" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="联系人">
            <el-input v-model="form.contact" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="电话">
            <el-input v-model="form.phone" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="传真">
            <el-input v-model="form.fax" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="邮箱">
            <el-input v-model="form.email" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="税号">
            <el-input v-model="form.taxNo" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="网站">
            <el-input v-model="form.website" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="地址">
            <el-input v-model="form.address" placeholder="详细地址" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>
