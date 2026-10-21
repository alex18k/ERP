<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { stockTransactionTypeApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, keyword: '' })

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const form = reactive<any>({ id: null, code: '', description: '', documentPrefix: '', direction: 'in', status: 1 })

const rules = {
  code: [{ required: true, message: '请输入事务代码', trigger: 'blur' }],
  description: [{ required: true, message: '请输入描述', trigger: 'blur' }],
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockTransactionTypeApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) Object.assign(form, row)
  else Object.keys(form).forEach((k) => { form[k] = null })
  form.documentPrefix = form.documentPrefix || ''
  form.direction = form.direction || 'in'
  form.status = form.status ?? 1
  dialogVisible.value = true
}

async function handleSave() {
  try { await formRef.value.validate() } catch { return }
  const payload = { code: form.code, description: form.description, documentPrefix: form.documentPrefix || null, direction: form.direction, status: form.status ?? 1 }
  if (isEdit.value) {
    await stockTransactionTypeApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await stockTransactionTypeApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除事务类型「${row.description}」吗？`, '提示', { type: 'warning' })
    await stockTransactionTypeApi.remove(row.id)
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
        <el-input v-model="query.keyword" placeholder="代码/描述" clearable style="width: 200px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增事务类型</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="事务代码" width="150" />
        <el-table-column label="单据" width="100">
          <template #default="{ row }">{{ row.documentPrefix || '-' }}</template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" />
        <el-table-column label="增减" width="100">
          <template #default="{ row }">
            <el-tag :type="row.direction === 'in' ? 'success' : 'danger'" size="small">{{ row.direction === 'in' ? '增' : '减' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的事务类型" :image-size="56">
            <div class="empty-tip">代码被库存流水引用时不能删除；可清空关键词后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑事务类型' : '新增事务类型'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="事务代码" prop="code">
          <el-input v-model="form.code" placeholder="如 ADJ-IN" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" placeholder="如 盘盈入库" />
        </el-form-item>
        <el-form-item label="单据">
          <div style="width: 100%">
            <el-input v-model="form.documentPrefix" placeholder="单据号前缀，如 RC" maxlength="10" show-word-limit />
            <div style="font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.4; margin-top: 2px">
              单据号前缀；留空时采购收货默认 RC，其它默认 ST
            </div>
          </div>
        </el-form-item>
        <el-form-item label="增减">
          <el-radio-group v-model="form.direction">
            <el-radio value="in">增</el-radio>
            <el-radio value="out">减</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
