<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { processRouteApi, workstationApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, code: '', name: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await processRouteApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

// ===== 新增/编辑 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const workstations = ref<any[]>([])
const processNameOptions = ref<string[]>([])
const form = reactive<any>({
  id: null,
  code: '',
  name: '',
  description: '',
  processes: [],
})

const rules = {
  code: [{ required: true, message: '请输入工艺路线编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入工艺名称', trigger: 'blur' }],
}

async function openDialog(row?: any) {
  const [wRes, rRes]: any[] = await Promise.all([
    workstationApi.list(),
    processRouteApi.list({ pageSize: 500 }),
  ])
  workstations.value = wRes.data
  const names = new Set<string>()
  for (const r of rRes.data.items) {
    for (const p of r.processes || []) {
      if (p.name) names.add(p.name)
    }
  }
  processNameOptions.value = [...names]

  isEdit.value = !!row
  if (row) {
    Object.assign(form, row)
    form.processes = row.processes?.map((p: any) => ({ ...p })) || []
  } else {
    Object.keys(form).forEach((k) => { form[k] = null })
    form.processes = []
  }
  dialogVisible.value = true
}

function addProcess() {
  form.processes.push({
    code: '',
    name: '',
    sequence: form.processes.length + 1,
    workstationId: null,
    standardTime: 0,
    setupTime: 0,
  })
}

function removeProcess(index: number) {
  form.processes.splice(index, 1)
}

async function handleSave() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  if (form.processes.length === 0) {
    ElMessage.warning('请至少添加一个工序')
    return
  }
  const payload = {
    code: form.code,
    name: form.name,
    description: form.description,
    processes: form.processes.map((p: any, i: number) => ({
      id: p.id,
      code: p.code || `OP${i + 1}`,
      name: p.name,
      sequence: p.sequence,
      workstationId: p.workstationId,
      standardTime: p.standardTime ?? 0,
      setupTime: p.setupTime ?? 0,
    })),
  }

  if (isEdit.value) {
    await processRouteApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await processRouteApi.create(payload)
    ElMessage.success('创建成功')
  }
  dialogVisible.value = false
  loadData()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除工艺路线「${row.name}」吗？`, '提示', { type: 'warning' })
    await processRouteApi.remove(row.id)
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
        <el-input v-model="query.code" placeholder="工艺路线编码" clearable style="width: 150px" />
        <el-input v-model="query.name" placeholder="工艺名称" clearable style="width: 180px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { code: '', name: '', page: 1 }), loadData()">重置</el-button>
        <el-button style="margin-left: auto" type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>新增工艺路线</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="工艺路线编码" width="110" />
        <el-table-column prop="name" label="工艺名称" width="120" />
        <el-table-column label="工序数" width="80">
          <template #default="{ row }">{{ row.processes?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column prop="totalTime" label="总工时" width="80" />
        <el-table-column label="工序明细">
          <template #default="{ row }">
            <el-tag v-for="p in row.processes" :key="p.id" size="small" style="margin-right: 4px; margin-bottom: 2px">
              {{ p.sequence }}. {{ p.name }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑工艺路线' : '新增工艺路线'" width="860px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="工艺路线编码" prop="code">
              <el-input v-model="form.code" placeholder="如 ROUTE-001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工艺名称" prop="name">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="工艺路线说明/描述" />
        </el-form-item>

        <el-form-item label="工序配置">
          <div style="width: 100%">
            <el-button size="small" type="primary" plain @click="addProcess">
              <el-icon><Plus /></el-icon>添加工序
            </el-button>
            <el-table :data="form.processes" size="small" style="margin-top: 8px; width: 100%">
              <el-table-column label="序号" width="110">
                <template #default="{ row }">
                  <el-input-number v-model="row.sequence" :min="1" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="工序编码" width="100">
                <template #default="{ row }">
                  <el-input v-model="row.code" size="small" placeholder="如 OP001" />
                </template>
              </el-table-column>
              <el-table-column label="工序名称" min-width="130">
                <template #default="{ row }">
                  <el-select v-model="row.name" size="small" filterable allow-create default-first-option placeholder="选择或输入" style="width: 100%">
                    <el-option v-for="n in processNameOptions" :key="n" :label="n" :value="n" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="工位" min-width="140">
                <template #default="{ row }">
                  <el-select v-model="row.workstationId" size="small" clearable placeholder="选择工位" style="width: 100%">
                    <el-option v-for="w in workstations" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="标准工时" width="80">
                <template #default="{ row }">
                  <el-input-number v-model="row.standardTime" :min="0" :controls="false" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="准备工时" width="80">
                <template #default="{ row }">
                  <el-input-number v-model="row.setupTime" :min="0" :controls="false" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column width="60">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeProcess($index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>