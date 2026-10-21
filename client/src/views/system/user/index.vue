<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { systemApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' })

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const roles = ref<any[]>([])
const departments = ref<any[]>([])
const form = reactive<any>({ id: null, username: '', password: '', realName: '', email: '', phone: '', departmentId: null, status: 1, roleIds: [] })

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  realName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入初始密码', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await systemApi.users(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

async function openDialog(row?: any) {
  const [rRes, dRes] = await Promise.all([systemApi.roles(), systemApi.departments()])
  roles.value = rRes.data
  departments.value = dRes.data

  isEdit.value = !!row
  if (row) {
    Object.assign(form, row)
    form.roleIds = row.userRoles?.map((ur: any) => ur.role.id) || []
    form.password = ''
    delete form.department
    delete form.userRoles
  } else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.roleIds = []
    form.status = 1
  }
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    username: form.username,
    password: form.password,
    realName: form.realName,
    email: form.email,
    phone: form.phone,
    departmentId: form.departmentId,
    status: form.status,
    roleIds: form.roleIds,
  }
  if (isEdit.value) {
    delete payload.username
    if (!payload.password) delete payload.password
    await systemApi.updateUser(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await systemApi.createUser(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定停用并删除用户「${row.realName}」吗？`, '提示', { type: 'warning' })
    await systemApi.deleteUser(row.id)
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
        <el-input v-model="query.keyword" placeholder="用户名/姓名" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 110px">
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
      </div>

      <div class="table-toolbar">
        <el-button type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增用户</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column prop="realName" label="姓名" width="110" />
        <el-table-column label="部门" width="110">
          <template #default="{ row }">{{ row.department?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" min-width="150">
          <template #default="{ row }">
            <el-tag v-for="ur in row.userRoles" :key="ur.id" size="small" style="margin-right: 4px">{{ ur.role.name }}</el-tag>
            <span v-if="!row.userRoles?.length">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="140" />
        <el-table-column prop="phone" label="电话" width="120" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button v-if="row.username !== 'admin'" size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的用户" :image-size="56">
            <div class="empty-tip">可清空关键词/状态后重试，或点右上角新增用户</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑用户' : '新增用户'" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" :disabled="isEdit" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="姓名" prop="realName">
              <el-input v-model="form.realName" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item :label="isEdit ? '重置密码' : '初始密码'" :prop="isEdit ? '' : 'password'">
          <el-input v-model="form.password" type="password" show-password :placeholder="isEdit ? '留空则不修改' : '请输入初始密码'" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="form.departmentId" clearable style="width: 100%">
            <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleIds" multiple style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="form.email" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话">
              <el-input v-model="form.phone" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>