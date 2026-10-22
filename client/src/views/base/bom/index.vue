<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bomApi, materialApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, name: '', productKeyword: '', status: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await bomApi.list(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function formatStatus(val: string) {
  return { draft: '草稿', active: '启用', obsolete: '停用' }[val] || val
}

function handleSearch() {
  query.page = 1
  loadData()
}

function resetQuery() {
  Object.assign(query, { name: '', productKeyword: '', status: '', page: 1 })
  loadData()
}

// ===== 新增/编辑 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref()
const products = ref<any[]>([])
const productLoading = ref(false)
const selectedProduct = ref<any>(null)
const matList = ref<any[]>([])
const form = reactive<any>({
  id: null,
  productId: null,
  version: '1.0',
  items: [],
})

const rules = {
  productId: [{ required: true, message: '请选择父零件', trigger: 'change' }],
}

async function openDialog(row?: any) {
  isEdit.value = !!row
  if (row) {
    const full: any = await bomApi.get(row.id)
    Object.assign(form, row, full.data)
    form.items = full.data.items?.map((i: any) => ({ ...i })) || []
    matList.value = (form.items || [])
      .map((i: any) => i.material && { id: i.material.id, code: i.material.code, name: i.material.name, specification: i.material.specification, unit: i.material.unit })
      .filter((m: any) => !!m)
    products.value = row.product ? [{ ...row.product }] : []
    selectedProduct.value = row.product ? { ...row.product } : null
    dialogVisible.value = true
  } else {
    Object.keys(form).forEach((k) => { form[k] = null })
    form.version = '1.0'
    form.items = []
    matList.value = []
    products.value = []
    selectedProduct.value = null
    dialogVisible.value = true
    queryProducts('')
  }
}

function onProductChange(val: number) {
  selectedProduct.value = products.value.find((p) => p.id === val) || null
}

async function queryProducts(keyword: string) {
  productLoading.value = true
  try {
    const res: any = await bomApi.productOptions({ keyword, limit: 50 })
    products.value = res.data as any[]
  } finally {
    productLoading.value = false
  }
}

// 「子BOM」标记集合：页面上缓存，非每次打开弹窗都请求
async function loadActiveBoms() {
  const activeRes: any = await bomApi.list({ pageSize: 500, status: 'active', lite: true })
  activeBomProducts.value = new Set((activeRes.data.items as any[]).map((b: any) => b.productId))
}

function addItem() {
  form.items.push({ materialId: null, quantity: 1, unit: '', lossRate: 0, sortOrder: form.items.length + 1 })
}

function removeItem(index: number) {
  form.items.splice(index, 1)
}

async function handleSave() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  if (form.items.length === 0) {
    ElMessage.warning('请至少添加一个子零件')
    return
  }
  const payload = {
    productId: form.productId,
    version: form.version,
    items: form.items.map((i: any) => ({
      materialId: i.materialId,
      quantity: i.quantity,
      unit: i.unit,
      lossRate: i.lossRate ?? 0,
      sortOrder: i.sortOrder,
    })),
  }

  if (isEdit.value) {
    await bomApi.update(form.id, payload)
    ElMessage.success('更新成功')
  } else {
    await bomApi.create(payload)
    ElMessage.success('创建成功，已自动启用')
  }
  dialogVisible.value = false
  await Promise.all([loadData(), loadActiveBoms()])
}

async function handleActivate(row: any) {
  try {
    await ElMessageBox.confirm(`确认启用BOM「${row.name}」？同产品其他BOM将被停用。`, '提示', { type: 'warning' })
    await bomApi.activate(row.id)
    ElMessage.success('启用成功')
    await Promise.all([loadData(), loadActiveBoms()])
  } catch { /* canceled */ }
}

async function handleDelete(row: any) {
  const tip = row.status === 'active'
    ? `BOM「${row.name}」当前为启用状态，删除后将影响 MRP 运算，确定删除？`
    : `确定删除BOM「${row.name}」吗？`
  try {
    await ElMessageBox.confirm(tip, '提示', { type: 'warning' })
    await bomApi.remove(row.id)
    ElMessage.success('删除成功')
    await Promise.all([loadData(), loadActiveBoms()])
  } catch { /* canceled */ }
}

function rowMaterial(row: any) {
  return row.material || matList.value.find((m) => m.id === row.materialId) || null
}

function rowMaterialLabel(row: any) {
  const m = rowMaterial(row)
  if (!m) return ''
  return m.specification ? `${m.name} - ${m.specification}` : (m.name || '')
}

async function queryMaterials(keyword: string) {
  const res: any = await materialApi.list({ pageSize: 50, keyword })
  matList.value = res.data.items
}

function onItemMaterialChange(item: any, val: any) {
  const mat = matList.value.find((m) => m.id === val)
  if (mat) {
    item.unit = mat.unit
    item.material = mat
  }
}

// ===== 打印 =====
function fmtQty(n: number) {
  return Math.round(n * 10000) / 10000
}

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function handlePrint(row: any) {
  const res: any = await bomApi.getTree(row.id)
  const data = res.data
  const product = data.product || {}
  const rows: any[] = []
  let seq = 0
  const push = (code: string, name: string, spec: string, qty: number, unit: string) => {
    seq += 1
    rows.push({ no: seq, code, name, spec, qty, unit })
  }
  push(product.code || row.code, product.name || row.name, product.specification || '', 1, product.unit || '')
  const walk = (nodes: any[], level: number) => {
    for (const n of nodes || []) {
      push('+'.repeat(level) + ' ' + (n.materialCode || ''), n.materialName || '', n.specification || '', n.quantity, n.unit || '')
      if (n.children?.length) walk(n.children, level + 1)
    }
  }
  walk(data.tree, 1)

  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const printDate = `${today.getFullYear()}/${pad(today.getMonth() + 1)}/${pad(today.getDate())}`

  const body = rows
    .map(
      (r) => `<tr>
      <td class="c">${r.no}</td>
      <td>${esc(r.code)}</td>
      <td>${esc(r.name)}</td>
      <td></td>
      <td>${esc(r.spec)}</td>
      <td class="c">${fmtQty(r.qty)}</td>
      <td class="c">${esc(r.unit)}</td>
      <td></td>
    </tr>`
    )
    .join('')

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />
<title>${esc(product.code || row.code)} BOM</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Microsoft YaHei", "微软雅黑", sans-serif; color: #000; margin: 0; }
  .head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
  .head .mid { text-align: center; }
  h1 { text-align: center; font-size: 18px; margin: 4px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; word-break: break-all; }
  th { background: #f2f2f2; text-align: center; font-weight: bold; }
  td.c { text-align: center; white-space: nowrap; }
  col.no { width: 5%; } col.code { width: 17%; } col.name { width: 13%; }
  col.pos { width: 9%; } col.spec { width: 34%; } col.qty { width: 7%; }
  col.unit { width: 7%; } col.remark { width: 8%; }
</style></head><body>
  <h1>物料清单（BOM）</h1>
  <div class="head">
    <span>型号: ${esc(product.code || row.code)}</span>
    <span class="mid">规格: ${esc(product.specification || '')}</span>
    <span>打印日期: ${printDate}</span>
  </div>
  <table>
    <colgroup>
      <col class="no" /><col class="code" /><col class="name" /><col class="pos" />
      <col class="spec" /><col class="qty" /><col class="unit" /><col class="remark" />
    </colgroup>
    <thead><tr>
      <th>#</th><th>物料号</th><th>物料名称</th><th>号位</th>
      <th>型号规格</th><th>用量</th><th>单位</th><th>备注</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <script>window.onload = function () { window.print(); }<\/script>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) {
    ElMessage.warning('浏览器拦截了打印窗口，请允许弹出窗口后重试')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

// ===== 编辑对话框：标记有激活子BOM的物料 =====
const activeBomProducts = ref<Set<number>>(new Set())

function hasActiveBom(materialId: number | null) {
  return materialId != null && activeBomProducts.value.has(materialId)
}

onMounted(() => {
  loadActiveBoms()
  loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.name" placeholder="BOM名称" clearable style="width: 180px" @keyup.enter="handleSearch" />
        <el-input v-model="query.productKeyword" placeholder="物料/规格名称" clearable style="width: 180px" @keyup.enter="handleSearch" />
        <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
        <el-button style="margin-left: auto" type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>新增BOM</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="name" label="父零件" min-width="150" />
        <el-table-column label="物料名称" min-width="180">
          <template #default="{ row }">{{ row.product?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="规格型号" min-width="180">
          <template #default="{ row }">{{ row.product?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="70" />
        <el-table-column label="明细数" width="80" align="right">
          <template #default="{ row }">{{ row._count?.items ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">{{ formatStatus(row.status) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="primary" link @click="handlePrint(row)">打印</el-button>
            <el-button v-if="row.status !== 'active'" size="small" type="primary" link @click="handleActivate(row)">启用</el-button>
            <el-button size="small" type="primary" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的BOM" :image-size="56">
            <div class="empty-tip">清空「BOM名称/物料规格名称」后重新查询，或点右上角新增BOM</div>
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

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑BOM' : '新增BOM'" width="1100px" destroy-on-close append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="父零件" prop="productId">
              <el-select
                v-model="form.productId"
                filterable
                remote
                :remote-method="queryProducts"
                :loading="productLoading"
                :disabled="isEdit"
                placeholder="搜索选择父零件"
                style="width: 100%"
                @change="onProductChange"
              >
                <el-option v-for="p in products" :key="p.id" :label="`${p.code} - ${p.name}`" :value="p.id" />
              </el-select>
              <div v-if="selectedProduct" style="display: flex; flex-wrap: wrap; gap: 4px 16px; color: #606266; font-size: 12px; line-height: 1.6; margin-top: 4px">
                <span>物料名称：{{ selectedProduct.name || '-' }}</span>
                <span>规格型号：{{ selectedProduct.specification || '-' }}</span>
              </div>
              <div style="color: #909399; font-size: 12px; line-height: 1.4; margin-top: 4px">
                {{ isEdit ? '父零件已锁定，仅可修改版本与明细' : 'BOM名称默认取所选物料的零件号，保存后自动启用' }}
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="版本号">
              <el-input v-model="form.version" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="子零件">
          <div style="width: 100%">
            <el-button size="small" type="primary" plain @click="addItem">
              <el-icon><Plus /></el-icon>添加子零件
            </el-button>
            <el-table :data="form.items" class="items-editor" size="small" style="margin-top: 8px; width: 100%">
              <el-table-column label="序号" width="55" type="index" />
              <el-table-column label="物料号" min-width="160">
                <template #default="{ row }">
                  <div style="display: flex; gap: 8px; align-items: center">
                    <el-select
                      v-model="row.materialId"
                      filterable
                      remote
                      :remote-method="queryMaterials"
                      placeholder="搜索选择物料"
                      style="width: 100%"
                      @change="(v: any) => onItemMaterialChange(row, v)"
                    >
                      <el-option v-for="m in matList" :key="m.id" :label="m.code" :value="m.id">
                        <span>{{ m.code }}</span>
                        <span style="margin-left: 10px; color: #909399">{{ m.name }}</span>
                        <span v-if="m.specification" style="margin-left: 10px; color: #909399">{{ m.specification }}</span>
                      </el-option>
                    </el-select>
                    <el-tag v-if="hasActiveBom(row.materialId)" size="small" type="success" style="flex-shrink: 0">子BOM</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="名称-型号规格" min-width="260">
                <template #default="{ row }">
                  <span style="color: #606266">{{ rowMaterialLabel(row) || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="用量" width="110">
                <template #default="{ row }">
                  <el-input-number v-model="row.quantity" :min="0.001" :precision="2" :controls="false" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column label="单位" width="70">
                <template #default="{ row }">
                  <el-input v-model="row.unit" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="损耗率" width="100">
                <template #default="{ row }">
                  <el-input-number v-model="row.lossRate" :min="0" :max="1" :step="0.01" :precision="2" :controls="false" size="small" style="width: 100%" />
                </template>
              </el-table-column>
              <el-table-column width="60">
                <template #default="{ $index }">
                  <el-button type="danger" link size="small" @click="removeItem($index)">删除</el-button>
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

<style>
/* BOM 明细行控件无边框：平时像纯文本，悬停/聚焦显示细线 */
.items-editor .el-input__wrapper,
.items-editor .el-select__wrapper {
  box-shadow: none;
  background: transparent;
  border-radius: 4px;
}
.items-editor .el-input__wrapper:hover,
.items-editor .el-select__wrapper:hover {
  box-shadow: 0 0 0 1px var(--erp-hairline) inset;
}
.items-editor .el-input__wrapper.is-focus,
.items-editor .el-select__wrapper.is-focused {
  box-shadow: 0 0 0 1px var(--erp-copper) inset;
  background: var(--el-fill-color-blank);
}
</style>