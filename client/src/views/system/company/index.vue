<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { systemApi } from '../../../api'
import { setCompanyInfo } from '../../../composables/useCompanyInfo'

const loading = ref(false)
const saving = ref(false)
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
    const res: any = await systemApi.company()
    const data = res.data || {}
    setCompanyInfo(data)
    for (const key of Object.keys(form)) form[key] = data[key] || ''
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  saving.value = true
  try {
    const payload: any = {}
    for (const key of Object.keys(form)) payload[key] = form[key]
    const res: any = await systemApi.updateCompany(payload)
    setCompanyInfo(res.data)
    ElMessage.success('公司信息保存成功')
    loadData()
  } catch { /* 错误已由拦截器提示 */ } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="page-header">
        <span>公司信息维护</span>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px" v-loading="loading" style="max-width: 900px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="公司名称（中文）" prop="nameZh">
              <el-input v-model="form.nameZh" placeholder="如 肇庆市博士芯电子科技有限公司" />
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
          <el-col :span="12">
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
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
          <el-button @click="loadData">重置</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>
