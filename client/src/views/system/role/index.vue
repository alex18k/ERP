<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { systemApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const permissions = ref<any[]>([])

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({ id: null, code: '', name: '', description: '', dataScope: 'own', permissionIds: [] })

const rules = {
  code: [{ required: true, message: '请输入角色编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await systemApi.roles()
    list.value = res.data
  } finally { loading.value = false }
}

async function openDialog(row?: any) {
  const pRes: any = await systemApi.permissions()
  permissions.value = pRes.data

  isEdit.value = !!row
  if (row) {
    Object.assign(form, row)
    form.permissionIds = row.permissionIds || []
    delete form._count
    delete form.rolePermissions
  } else {
    Object.keys(form).forEach((k) => (form[k] = null))
    form.dataScope = 'own'
    form.permissionIds = []
  }
  dialogVisible.value = true
}

async function handleDelete(row: any) {
  if (row.userCount > 0) {
    ElMessage.warning('该角色下存在用户，无法删除')
    return
  }
  try {
    await ElMessageBox.confirm(`确定删除角色「${row.name}」吗？`, '提示', { type: 'warning' })
    await systemApi.deleteRole(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    code: form.code,
    name: form.name,
    description: form.description,
    dataScope: form.dataScope,
    permissionIds: form.permissionIds,
  }
  if (isEdit.value) {
    await systemApi.updateRole(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await systemApi.createRole(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">角色与权限</span>
        <div style="flex: 1" />
        <el-button type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增角色</el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="角色编码" width="130" />
        <el-table-column prop="name" label="角色名称" width="140" />
        <el-table-column prop="description" label="描述" min-width="160">
          <template #default="{ row }">{{ row.description || '-' }}</template>
        </el-table-column>
        <el-table-column label="数据范围" width="100">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.dataScope === 'all' ? '全部' : '仅本人' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权限数" width="90">
          <template #default="{ row }">{{ row.permissionIds?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="用户数" width="80">
          <template #default="{ row }">{{ row.userCount ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑角色' : '新增角色'" width="720px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="角色编码" prop="code">
              <el-input v-model="form.code" :disabled="isEdit" placeholder="如 sales" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="角色名称" prop="name">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="数据范围">
          <el-radio-group v-model="form.dataScope">
            <el-radio value="all">全部数据</el-radio>
            <el-radio value="own">仅本人数据</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="功能权限">
          <el-scrollbar max-height="320px" style="width: 100%">
            <el-checkbox-group v-model="form.permissionIds">
              <el-checkbox v-for="p in permissions" :key="p.id" :value="p.id" style="width: 230px; margin-right: 0">
                {{ p.name }}
                <small style="color: var(--el-text-color-secondary)">（{{ p.code }}）</small>
              </el-checkbox>
            </el-checkbox-group>
          </el-scrollbar>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>