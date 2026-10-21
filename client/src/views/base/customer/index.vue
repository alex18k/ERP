<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { customerApi, systemApi } from '../../../api'

const customerTypes = ['终端客户', '经销商', '分销商', '电商', '其他']
const settleMethods = ['现结', '月结30天', '月结60天', '货到付款', '预付款', '其他']

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '' })
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({
  id: null, code: '', name: '', contactPerson: '', phone: '', email: '', address: '', joinedDate: '', type: '', seller: '', settleMethod: '', remark: '',
})

const rules = {
  code: [{ required: true, message: '请输入客户编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }],
}

function fmtDate(v: any) {
  if (!v) return ''
  return new Date(v).toLocaleDateString('sv-SE')
}

const userOptions = ref<string[]>([])

async function loadSellers() {
  try {
    const res: any = await systemApi.users({ pageSize: 100, status: 1 })
    const items: any[] = res.data.items || res.data || []
    userOptions.value = [...new Set(items.map((u: any) => u.realName || u.username).filter(Boolean))]
  } catch {
    userOptions.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await customerApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.joinedDate = todayStr()
  }
  loadSellers()
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload: any = { ...form }
  delete payload.id
  payload.joinedDate = form.joinedDate ? new Date(form.joinedDate).toISOString() : null
  if (isEdit.value) {
    await customerApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await customerApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除客户「${row.name}」吗？`, '提示', { type: 'warning' })
    await customerApi.remove(row.id)
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
        <el-input v-model="query.keyword" placeholder="编码/名称" clearable style="width: 200px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增客户</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="编码" width="100" />
        <el-table-column prop="name" label="客户名称" min-width="180" />
        <el-table-column prop="contactPerson" label="联系人" width="100" />
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column prop="address" label="地址" min-width="180" />
        <el-table-column prop="type" label="类型" width="90" />
        <el-table-column prop="seller" label="销售员" width="90" />
        <el-table-column prop="settleMethod" label="结算方式" width="110" />
        <el-table-column label="加入日期" width="110">
          <template #default="{ row }">{{ fmtDate(row.joinedDate) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的客户" :image-size="56">
            <div class="empty-tip">试试更短的关键词，或点右上角「新增客户」</div>
          </el-empty>
        </template>
</el-table>
      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑客户' : '新增客户'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="客户编码" prop="code">
          <el-input v-model="form.code" placeholder="如 CUS-001" />
        </el-form-item>
        <el-form-item label="客户名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="联系人">
              <el-input v-model="form.contactPerson" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话">
              <el-input v-model="form.phone" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="加入日期">
              <el-date-picker v-model="form.joinedDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="类型">
              <el-select v-model="form.type" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                <el-option v-for="t in customerTypes" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="销售员">
              <el-select v-model="form.seller" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                <el-option v-for="b in userOptions" :key="b" :label="b" :value="b" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结算方式">
              <el-select v-model="form.settleMethod" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                <el-option v-for="m in settleMethods" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
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