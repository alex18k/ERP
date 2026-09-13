<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi, systemApi } from '../../../api'

const supplierTypes = ['原材料', '委外加工', '辅料', '包装材料', '设备工装', '其他']
const settleMethods = ['现金', '月结', '月结30天', '月结60天', '货到付款', '预付款', '其他']
const taxRateOptions = [0, 1, 3, 5, 6, 9, 13]

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '' })
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({
  id: null, code: '', name: '', contactPerson: '', phone: '', email: '', address: '', joinedDate: '', type: '', buyer: '', settleMethod: '', taxIncluded: false, taxRate: 0, remark: '',
})

const rules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
}

function fmtDate(v: any) {
  if (!v) return ''
  return new Date(v).toLocaleDateString('sv-SE')
}

const userOptions = ref<string[]>([])

async function loadBuyers() {
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
    const res: any = await supplierApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.taxIncluded = false
    form.taxRate = 0
  }
  loadBuyers()
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload: any = { ...form }
  delete payload.id
  payload.joinedDate = form.joinedDate ? new Date(form.joinedDate).toISOString() : null
  if (isEdit.value) {
    await supplierApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await supplierApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除供应商「${row.name}」吗？`, '提示', { type: 'warning' })
    await supplierApi.remove(row.id)
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
        <el-button style="margin-left: auto" type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>新增供应商</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="code" label="编码" width="100" />
        <el-table-column prop="name" label="供应商名称" min-width="160" />
        <el-table-column prop="contactPerson" label="联系人" width="100" />
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column prop="email" label="邮箱" min-width="150" />
        <el-table-column prop="type" label="类型" width="90" />
        <el-table-column prop="buyer" label="采购员" width="90" />
        <el-table-column prop="settleMethod" label="结算方式" width="100" />
        <el-table-column label="含税" width="70">
          <template #default="{ row }">{{ row.taxIncluded ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="税率" width="80">
          <template #default="{ row }">{{ row.taxRate ?? 0 }}%</template>
        </el-table-column>
        <el-table-column label="加入日期" width="110">
          <template #default="{ row }">{{ fmtDate(row.joinedDate) }}</template>
        </el-table-column>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑供应商' : '新增供应商'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="供应商编码" prop="code">
          <el-input v-model="form.code" placeholder="如 SUP-001" />
        </el-form-item>
        <el-form-item label="供应商名称" prop="name">
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
                <el-option v-for="t in supplierTypes" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="采购员">
              <el-select v-model="form.buyer" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
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
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="含税">
              <el-checkbox v-model="form.taxIncluded">默认含税价</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="税率">
              <el-select v-model="form.taxRate" filterable allow-create default-first-option placeholder="默认税率" style="width: 100%">
                <el-option v-for="r in taxRateOptions" :key="r" :label="`${r}%`" :value="r" />
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