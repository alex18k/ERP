<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { workstationApi, workshopApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const query = reactive({ workshopId: '' })
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const workshops = ref<any[]>([])
const form = reactive<any>({
  id: null, code: '', name: '', workshopId: null, type: '', capacity: 1, status: 1,
})

const rules = {
  code: [{ required: true, message: '请输入工位编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入工位名称', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await workstationApi.list(query)
    list.value = res.data
    loading.value = false
  } catch { loading.value = false }
}

async function loadWorkshops() {
  const res: any = await workshopApi.list()
  workshops.value = res.data
}

async function openDialog(row?: any) {
  await loadWorkshops()
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else Object.keys(form).forEach((k) => (form[k] = null))
  form.capacity = form.capacity ?? 1
  form.status = form.status ?? 1
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = { ...form }
  delete payload.id
  delete payload.workshop
  if (isEdit.value) {
    await workstationApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await workstationApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除工位「${row.name}」吗？`, '提示', { type: 'warning' })
    await workstationApi.remove(row.id)
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
        <el-select v-model="query.workshopId" placeholder="按车间筛选" clearable style="width: 180px" @change="loadData">
          <el-option v-for="w in workshops" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="loadData"><el-icon><Search /></el-icon>查询</el-button>
        <el-button style="margin-left: auto" type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>新增工位</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="工位编码" width="110" />
        <el-table-column prop="name" label="工位名称" min-width="140" />
        <el-table-column label="所属车间" min-width="120">
          <template #default="{ row }">{{ row.workshop?.name }}</template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column prop="capacity" label="产能" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑工位' : '新增工位'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="工位编码" prop="code">
          <el-input v-model="form.code" placeholder="如 ST-A01" />
        </el-form-item>
        <el-form-item label="工位名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="所属车间">
          <el-select v-model="form.workshopId" clearable style="width: 100%">
            <el-option v-for="w in workshops" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="工位类型">
          <el-input v-model="form.type" placeholder="如 冲压/焊接/组装" />
        </el-form-item>
        <el-form-item label="产能">
          <el-input-number v-model="form.capacity" :min="1" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>