<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { workshopApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({ id: null, code: '', name: '', manager: '', status: 1 })

const rules = {
  code: [{ required: true, message: '请输入车间编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入车间名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await workshopApi.list()
    list.value = res.data
  } finally {
    loading.value = false
  }
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else Object.keys(form).forEach((k) => { form[k] = null })
  form.status = form.status ?? 1
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    code: form.code,
    name: form.name,
    manager: form.manager,
    status: form.status ?? 1,
  }
  if (isEdit.value) {
    await workshopApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await workshopApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除车间「${row.name}」吗？`, '提示', { type: 'warning' })
    await workshopApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <el-button type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>新增车间</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="code" label="车间编码" width="120" />
        <el-table-column prop="name" label="车间名称" min-width="160" />
        <el-table-column prop="manager" label="负责人" width="140" />
        <el-table-column label="工位数" width="90">
          <template #default="{ row }">{{ row.workstations?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑车间' : '新增车间'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="车间编码" prop="code">
          <el-input v-model="form.code" placeholder="如 WS-01" />
        </el-form-item>
        <el-form-item label="车间名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="form.manager" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
