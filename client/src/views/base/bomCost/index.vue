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
  const push = (code: string, name: string, spec: string, qty: number, unit: string, cost: number) => {
    seq += 1
    rows.push({ no: seq, code, name, spec, qty, unit, cost, amount: (qty || 0) * (cost || 0) })
  }
  push(product.code || row.code, product.name || row.name, product.specification || '', 1, product.unit || '', product.cost || 0)
  const walk = (nodes: any[], level: number) => {
    for (const n of nodes || []) {
      push('+'.repeat(level) + ' ' + (n.materialCode || ''), n.materialName || '', n.specification || '', n.totalQuantity, n.unit || '', n.cost || 0)
      if (n.children?.length) walk(n.children, level + 1)
    }
  }
  walk(data.tree, 1)

  // BOM 物料成本：按叶子物料（无子BOM）累计用量×成本，避免半成品重复计算
  const leafCost = (nodes: any[]): number => {
    let sum = 0
    for (const n of nodes || []) {
      if (n.hasSubBom && n.children?.length) sum += leafCost(n.children)
      else sum += (n.totalQuantity || 0) * (n.cost || 0)
    }
    return sum
  }
  const totalCost = leafCost(data.tree)

  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const printDate = `${today.getFullYear()}/${pad(today.getMonth() + 1)}/${pad(today.getDate())}`

  const body = rows
    .map(
      (r) => `<tr>
      <td class="c">${r.no}</td>
      <td>${esc(r.code)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.spec)}</td>
      <td class="c">${fmtQty(r.qty)}</td>
      <td class="c">${esc(r.unit)}</td>
      <td class="r">${(r.cost || 0).toFixed(4)}</td>
      <td class="r">${(r.amount || 0).toFixed(4)}</td>
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
  td.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  col.no { width: 5%; } col.code { width: 16%; } col.name { width: 14%; }
  col.spec { width: 30%; } col.qty { width: 9%; } col.unit { width: 7%; }
  col.cost { width: 9%; } col.amt { width: 10%; }
  tfoot td { font-weight: bold; background: #fafafa; }
</style></head><body>
  <h1>物料清单（BOM）</h1>
  <div class="head">
    <span>型号: ${esc(product.code || row.code)}</span>
    <span class="mid">规格: ${esc(product.specification || '')}</span>
    <span>打印日期: ${printDate}</span>
  </div>
  <table>
    <colgroup>
      <col class="no" /><col class="code" /><col class="name" />
      <col class="spec" /><col class="qty" /><col class="unit" /><col class="cost" /><col class="amt" />
    </colgroup>
    <thead><tr>
      <th>#</th><th>物料号</th><th>物料名称</th>
      <th>型号规格</th><th>累计用量</th><th>单位</th><th>单价</th><th>金额</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td colspan="7" class="r">物料成本合计</td>
      <td class="r">${totalCost.toFixed(4)}</td>
    </tr></tfoot>
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

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="code" label="BOM编码" min-width="170" />
        <el-table-column prop="name" label="BOM名称" min-width="150" />
        <el-table-column label="产出物料" min-width="160">
          <template #default="{ row }">{{ row.product?.code }} - {{ row.product?.name }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="70" />
        <el-table-column label="明细数" width="80">
          <template #default="{ row }">{{ row.items?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">{{ formatStatus(row.status) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="handlePrint(row)">打印</el-button>
            <el-button v-if="row.status !== 'active'" size="small" type="primary" link @click="handleActivate(row)">启用</el-button>
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
  </div>
</template>
