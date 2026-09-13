<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bomApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, code: '', name: '', status: '' })

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

function statusType(val: string) {
  return { draft: 'info', active: 'success', obsolete: 'warning' }[val] || 'info'
}

function handleSearch() {
  query.page = 1
  loadData()
}

function resetQuery() {
  Object.assign(query, { code: '', name: '', status: '', page: 1 })
  loadData()
}

async function handleActivate(row: any) {
  try {
    await ElMessageBox.confirm(`确认启用BOM「${row.name}」？同产品其他BOM将被停用。`, '提示', { type: 'warning' })
    await bomApi.activate(row.id)
    ElMessage.success('启用成功')
    loadData()
  } catch { /* canceled */ }
}

// ===== 结构树 =====
const treeVisible = ref(false)
const treeLoading = ref(false)
const treeTitle = ref('')
const treeData = ref<any[]>([])

function fmtQty(n: number) {
  return Math.round(n * 10000) / 10000
}

async function openTree(row: any) {
  treeVisible.value = true
  treeLoading.value = true
  treeTitle.value = `${row.code} - ${row.name}`
  try {
    const res: any = await bomApi.getTree(row.id)
    treeData.value = res.data.tree || []
  } finally {
    treeLoading.value = false
  }
}

// ===== 打印 =====
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
  <div class="head">
    <span>型号: ${esc(product.code || row.code)}</span>
    <span class="mid">规格: ${esc(product.specification || '')}</span>
    <span>打印日期: ${printDate}</span>
  </div>
  <h1>物料清单（BOM）</h1>
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

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.code" placeholder="BOM编码" clearable style="width: 150px" />
        <el-input v-model="query.name" placeholder="BOM名称" clearable style="width: 180px" />
        <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="code" label="BOM编码" width="110" />
        <el-table-column prop="name" label="BOM名称" min-width="150" />
        <el-table-column label="产出物料" min-width="160">
          <template #default="{ row }">{{ row.product?.code }} - {{ row.product?.name }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="70" />
        <el-table-column label="明细数" width="80">
          <template #default="{ row }">{{ row.items?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ formatStatus(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="info" link @click="openTree(row)">结构树</el-button>
            <el-button size="small" type="warning" link @click="handlePrint(row)">打印</el-button>
            <el-button v-if="row.status !== 'active'" size="small" type="success" link @click="handleActivate(row)">启用</el-button>
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

    <!-- 产品结构树对话框 -->
    <el-dialog v-model="treeVisible" :title="`产品结构树 - ${treeTitle}`" width="760px">
      <div v-loading="treeLoading" style="max-height: 60vh; overflow: auto">
        <el-tree :data="treeData" :props="{ children: 'children', label: 'materialCode' }" default-expand-all>
          <template #default="{ data }">
            <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap">
              <span>{{ data.materialCode }} - {{ data.materialName }}</span>
              <span v-if="data.specification" style="color: #909399">规格: {{ data.specification }}</span>
              <span style="color: #909399">单件 {{ fmtQty(data.quantity) }} {{ data.unit }}</span>
              <span style="color: #909399">×{{ fmtQty(data.totalQuantity) }}</span>
              <span v-if="data.lossRate > 0" style="color: #909399">损耗{{ (data.lossRate * 100).toFixed(1) }}%</span>
            </div>
          </template>
        </el-tree>
        <el-empty v-if="!treeLoading && treeData.length === 0" description="该BOM暂无明细" />
      </div>
      <template #footer>
        <el-button @click="treeVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>
