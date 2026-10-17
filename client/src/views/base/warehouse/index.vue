<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { warehouseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '' })
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({
  id: null, code: '', name: '', address: '', status: 1, binManaged: false,
})

const rules = {
  code: [{ required: true, message: '请输入仓库编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入仓库名称', trigger: 'blur' }],
}

const statusOptions = [
  { label: '有效', value: 1 },
  { label: '无效', value: 0 },
]

async function loadData() {
  loading.value = true
  try {
    const res: any = await warehouseApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else Object.keys(form).forEach((k) => (form[k] = null))
  form.status = form.status ?? 1
  form.binManaged = !!form.binManaged
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    code: form.code,
    name: form.name,
    address: form.address,
    status: form.status ?? 1,
    binManaged: !!form.binManaged,
  }
  if (isEdit.value) {
    await warehouseApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await warehouseApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除仓库「${row.name}」吗？`, '提示', { type: 'warning' })
    await warehouseApi.remove(row.id)
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
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增仓库</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="编码" width="100" />
        <el-table-column prop="name" label="仓库名称" min-width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'success'">{{ row.status === 0 ? '无效' : '有效' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="address" label="地址" min-width="180" />
        <el-table-column label="货位管理" width="100">
          <template #default="{ row }">
            <el-tag :type="row.binManaged ? 'warning' : 'info'">{{ row.binManaged ? '启用' : '未启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="物料种类" width="100">
          <template #default="{ row }">{{ row.stocks?.length ?? 0 }}</template>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑仓库' : '新增仓库'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="仓库编码" prop="code">
          <el-input v-model="form.code" placeholder="如 WH-01" />
        </el-form-item>
        <el-form-item label="仓库名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="仓库状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="货位管理">
          <el-switch v-model="form.binManaged" />
          <span style="margin-left: 8px; color: #909399; font-size: 12px">启用后该仓库库存按货位细分，出入库必须指定货位</span>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>