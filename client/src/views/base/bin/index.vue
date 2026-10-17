<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { warehouseBinApi, warehouseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, keyword: '', warehouseId: '' })

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({
  id: null, warehouseId: null, code: '', name: '', status: 1, remark: '',
})

const rules = {
  warehouseId: [{ required: true, message: '请选择所属仓库', trigger: 'change' }],
  code: [{ required: true, message: '请输入货位编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入货位名称', trigger: 'blur' }],
}

const statusOptions = [
  { label: '启用', value: 1 },
  { label: '停用', value: 0 },
]

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await warehouseBinApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function openDialog(row?: any) {
  isEdit.value = !!row
  Object.assign(form, { id: null, warehouseId: query.warehouseId || null, code: '', name: '', status: 1, remark: '' })
  if (row) Object.assign(form, row)
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = {
    warehouseId: form.warehouseId,
    code: form.code,
    name: form.name,
    status: form.status ?? 1,
    remark: form.remark,
  }
  if (isEdit.value) {
    await warehouseBinApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await warehouseBinApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除货位「${row.warehouse?.name || ''} / ${row.name}」吗？`, '提示', { type: 'warning' })
    await warehouseBinApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch { /* canceled */ }
}

onMounted(async () => {
  await loadWarehouses()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.keyword" placeholder="货位编码/名称" clearable style="width: 200px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.warehouseId" placeholder="所属仓库" clearable style="width: 180px">
          <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { keyword: '', warehouseId: '', page: 1 }), loadData()">重置</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增货位</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="所属仓库" min-width="160">
          <template #default="{ row }">
            <span v-if="row.warehouse">{{ row.warehouse.code }} - {{ row.warehouse.name }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="货位编码" width="140" />
        <el-table-column prop="name" label="货位名称" min-width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'success'">{{ row.status === 0 ? '停用' : '启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="160">
          <template #default="{ row }">{{ row.remark || '-' }}</template>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑货位' : '新增货位'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="所属仓库" prop="warehouseId">
          <el-select v-model="form.warehouseId" placeholder="选择仓库" filterable style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="货位编码" prop="code">
          <el-input v-model="form.code" placeholder="如 A01-01" />
        </el-form-item>
        <el-form-item label="货位名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
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
