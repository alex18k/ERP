<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { purchaseApi, stockApi, warehouseApi, warehouseBinApi, workshopApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', supplierKeyword: '', materialKeyword: '', startDate: '', endDate: '' })

const warehouses = ref<any[]>([])
const departments = ref<any[]>([])
const handlerOptions = ref<string[]>([])

const returnVisible = ref(false)
const returning = ref(false)
const currentOrder = ref<any>(null)
const returnLines = ref<any[]>([])
const returnForm = reactive({
  effectiveDate: todayStr(),
  departmentId: null as number | null,
  handler: '',
  remark: '',
})

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateOnly(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : '-'
}

function fmtQty(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function onQuantityInput(row: any, value: number | undefined) {
  if (value != null && value < 0) row.returnQty = 0
}

function preventNegativeKey(e: KeyboardEvent) {
  if (e.key === '-' || e.key === '+' || e.key.toLowerCase() === 'e') e.preventDefault()
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await purchaseApi.returnOrders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  const [wRes, dRes, hRes]: any[] = await Promise.all([
    warehouseApi.list({ pageSize: 200 }),
    workshopApi.list(),
    stockApi.handlers(),
  ])
  const whs = wRes.data.items || wRes.data || []
  warehouses.value = whs.filter((w: any) => w.status === 1)
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  handlerOptions.value = hRes.data || []
}

function openReturn(row: any) {
  if (fmtQty(row.returnableQty) <= 0) {
    ElMessage.warning('该采购订单已全部退货')
    return
  }
  currentOrder.value = row
  returnLines.value = (row.items || [])
    .filter((l: any) => fmtQty(l.returnableQty) > 0)
    .map((l: any) => ({
      ...l,
      returnQty: 0,
      warehouseId: null,
      binId: null,
      batchNo: '',
      bins: [],
      batches: [],
      binLoading: false,
      batchLoading: false,
    }))
  returnForm.effectiveDate = todayStr()
  returnForm.departmentId = null
  returnForm.handler = ''
  returnForm.remark = ''
  returnVisible.value = true
  if (warehouses.value.length === 0) loadOptions().catch(() => {})
}

function lineWarehouse(row: any) {
  return warehouses.value.find((w: any) => w.id === row.warehouseId) || null
}

function lineBinManaged(row: any) {
  return lineWarehouse(row)?.binManaged === true
}

function lineBatchRequired(row: any) {
  return row.material?.batchManaged === true || (row.batches?.length ?? 0) > 0
}

function lineBatchQty(row: any) {
  const b = (row.batches || []).find((x: any) => x.batchNo === row.batchNo)
  return b ? Number(b.quantity) : 0
}

async function loadLineBatches(row: any) {
  if (!row.materialId || !row.warehouseId) {
    row.batches = []
    return
  }
  row.batchLoading = true
  try {
    const res: any = await stockApi.batches({
      materialId: row.materialId,
      warehouseId: row.warehouseId,
      binId: row.binId || undefined,
      pageSize: 200,
    })
    row.batches = res.data.items || []
  } catch {
    row.batches = []
  } finally {
    row.batchLoading = false
  }
}

async function onLineWarehouseChange(row: any) {
  row.binId = null
  row.batchNo = ''
  row.bins = []
  row.batches = []
  const wh = lineWarehouse(row)
  if (!wh) return
  if (wh.binManaged) {
    row.binLoading = true
    try {
      const res: any = await warehouseBinApi.list({ warehouseId: wh.id, status: 1, pageSize: 200 })
      row.bins = res.data.items || []
    } catch {
      row.bins = []
    } finally {
      row.binLoading = false
    }
  }
  await loadLineBatches(row)
}

function onLineBinChange(row: any) {
  row.batchNo = ''
  row.batches = []
  loadLineBatches(row)
}

function toggleFill() {
  const fill = !returnLines.value.some((l: any) => Number(l.returnQty) > 0)
  for (const line of returnLines.value) {
    line.returnQty = fill ? fmtQty(line.returnableQty) : 0
  }
}

async function submitReturn() {
  const order = currentOrder.value
  if (!order) return
  if (!returnForm.departmentId) {
    ElMessage.warning('请选择部门')
    return
  }
  if (!String(returnForm.handler || '').trim()) {
    ElMessage.warning('请输入经手人')
    return
  }
  const lines = returnLines.value.filter((l: any) => Number(l.returnQty) > 0)
  if (lines.length === 0) {
    ElMessage.warning('请至少填写一条退货数量')
    return
  }
  for (const line of lines) {
    if (fmtQty(line.returnQty) > fmtQty(line.returnableQty) + 1e-6) {
      ElMessage.warning(`${line.material?.code || ''} 退货数量不能超过可退数量 ${line.returnableQty}`)
      return
    }
    if (!line.warehouseId) {
      ElMessage.warning(`${line.material?.code || ''} 请选择仓库`)
      return
    }
    if (lineBatchRequired(line) && !line.batchNo) {
      ElMessage.warning(`${line.material?.code || ''} 请选择批号`)
      return
    }
    if (line.batchNo && fmtQty(line.returnQty) > lineBatchQty(line) + 1e-6) {
      ElMessage.warning(`${line.material?.code || ''} 退货数量不能超过该批号余量 ${lineBatchQty(line)}`)
      return
    }
  }
  returning.value = true
  try {
    const res: any = await purchaseApi.returnOrder(order.id, {
      items: lines.map((line: any) => ({
        itemId: line.id,
        quantity: line.returnQty,
        warehouseId: line.warehouseId,
        binId: lineBinManaged(line) ? line.binId : undefined,
        batchNo: line.batchNo || undefined,
      })),
      effectiveDate: returnForm.effectiveDate || undefined,
      departmentId: returnForm.departmentId || undefined,
      handler: returnForm.handler || undefined,
      remark: returnForm.remark || undefined,
    })
    ElMessage.success(res.data?.documentNo ? `退货已提交，退货单号 ${res.data.documentNo}` : '退货已提交')
    returnVisible.value = false
    await loadData()
  } catch { /* error shown by interceptor */ } finally {
    returning.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadData(), loadOptions()])
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.supplierKeyword" placeholder="供应商编码/名称" clearable style="width: 170px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 190px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.startDate" type="date" placeholder="订货开始" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="订货结束" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', supplierKeyword: '', materialKeyword: '', startDate: '', endDate: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column type="expand" width="40">
          <template #default="{ row }">
            <div class="return-detail">
              <el-table :data="row.items" size="small" border>
                <el-table-column label="行号" width="60" align="center">
                  <template #default="{ row: l }">{{ l.line ?? '-' }}</template>
                </el-table-column>
                <el-table-column label="物料编码" width="110" show-overflow-tooltip>
                  <template #default="{ row: l }">{{ l.material?.code }}</template>
                </el-table-column>
                <el-table-column label="物料名称" min-width="130" show-overflow-tooltip>
                  <template #default="{ row: l }">{{ l.material?.name }}</template>
                </el-table-column>
                <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
                  <template #default="{ row: l }">{{ l.material?.specification || '-' }}</template>
                </el-table-column>
                <el-table-column label="订货数量" width="90" align="right">
                  <template #default="{ row: l }">{{ l.quantity }}</template>
                </el-table-column>
                <el-table-column label="收货数量" width="90" align="right">
                  <template #default="{ row: l }">{{ l.receivedQty }}</template>
                </el-table-column>
                <el-table-column label="已退数量" width="90" align="right">
                  <template #default="{ row: l }">{{ l.returnedQty }}</template>
                </el-table-column>
                <el-table-column label="可退数量" width="90" align="right">
                  <template #default="{ row: l }">{{ l.returnableQty }}</template>
                </el-table-column>
                <el-table-column label="单位" width="70">
                  <template #default="{ row: l }">{{ l.unit || '-' }}</template>
                </el-table-column>
                <el-table-column label="物料库位" width="100" show-overflow-tooltip>
                  <template #default="{ row: l }">{{ l.location || '-' }}</template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="采购单号" width="160">
          <template #default="{ row }">{{ row.orderNo }}</template>
        </el-table-column>
        <el-table-column label="供应商" min-width="150">
          <template #default="{ row }">{{ row.supplierName || '未指定' }}</template>
        </el-table-column>
        <el-table-column label="订货日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="截止日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.expectedDate) }}</template>
        </el-table-column>
        <el-table-column label="采购员" width="100">
          <template #default="{ row }">{{ row.buyer || '-' }}</template>
        </el-table-column>
        <el-table-column label="行数" width="70" align="center">
          <template #default="{ row }">{{ row.lineCount ?? row.items?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="收货数量" width="100" align="right">
          <template #default="{ row }">{{ row.totalReceivedQty }}</template>
        </el-table-column>
        <el-table-column label="已退数量" width="100" align="right">
          <template #default="{ row }">{{ row.returnedQty }}</template>
        </el-table-column>
        <el-table-column label="可退数量" width="100" align="right">
          <template #default="{ row }">{{ row.returnableQty }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" link size="small" :disabled="fmtQty(row.returnableQty) <= 0" @click="openReturn(row)">退货</el-button>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有符合条件的采购单" :image-size="56">
            <div class="empty-tip">仅已确认且存在可退数量的采购单可退货；可清空单号/供应商/日期条件后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="returnVisible" :title="`采购退货 - ${currentOrder?.orderNo || ''}`" width="1250px" destroy-on-close :close-on-click-modal="false">
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="采购单号">{{ currentOrder?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ currentOrder?.supplierName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="订货日期">{{ dateOnly(currentOrder?.orderDate) }}</el-descriptions-item>
        <el-descriptions-item label="采购员">{{ currentOrder?.buyer || '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-form :model="returnForm" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="生效日期">
              <el-input v-model="returnForm.effectiveDate" type="date" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="部门" required>
              <el-select v-model="returnForm.departmentId" filterable clearable placeholder="选择部门" style="width: 100%">
                <el-option v-for="d in departments" :key="d.id" :label="`${d.code} - ${d.name}`" :value="d.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="经手人" required>
              <el-select v-model="returnForm.handler" filterable clearable allow-create default-first-option placeholder="选择或输入经手人" style="width: 100%">
                <el-option v-for="h in handlerOptions" :key="h" :label="h" :value="h" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="备注">
              <el-input v-model="returnForm.remark" placeholder="备注" clearable />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div class="table-toolbar">
        <span class="toolbar-title">退货明细</span>
        <div style="flex: 1" />
        <span class="doc-summary" style="margin-right: 10px">
          已填 <b>{{ returnLines.filter((l: any) => Number(l.returnQty) > 0).length }}</b> 行 · 退货数量合计
          <b>{{ returnLines.reduce((s: number, l: any) => s + (Number(l.returnQty) || 0), 0) }}</b>
        </span>
        <el-button size="small" @click="toggleFill">{{ returnLines.some((l: any) => Number(l.returnQty) > 0) ? '清空数量' : '填充可退数量' }}</el-button>
      </div>

      <el-table class="grid-items" :data="returnLines" size="small" border max-height="420" :row-class-name="({ row }: any) => (Number(row.returnQty) > 0 ? 'row-red' : '')">
        <el-table-column label="行号" width="55" align="center">
          <template #default="{ row }">{{ row.line ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="105" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column label="收货数量" width="85" align="right">
          <template #default="{ row }">{{ row.receivedQty }}</template>
        </el-table-column>
        <el-table-column label="已退数量" width="85" align="right">
          <template #default="{ row }">{{ row.returnedQty }}</template>
        </el-table-column>
        <el-table-column label="可退数量" width="85" align="right">
          <template #default="{ row }">{{ row.returnableQty }}</template>
        </el-table-column>
        <el-table-column label="本次退货" width="105">
          <template #default="{ row }">
            <el-input-number
              v-model="row.returnQty"
              :min="0"
              :max="fmtQty(row.returnableQty)"
              :precision="2"
              :controls="false"
              :disabled="fmtQty(row.returnableQty) <= 0"
              style="width: 100%"
              @input="(v: number | undefined) => onQuantityInput(row, v)"
              @keydown="preventNegativeKey"
            />
          </template>
        </el-table-column>
        <el-table-column label="单位" width="65">
          <template #default="{ row }">{{ row.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="140">
          <template #default="{ row }">
            <el-select v-model="row.warehouseId" filterable placeholder="选择仓库" style="width: 100%" @change="onLineWarehouseChange(row)">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="货位" width="130">
          <template #default="{ row }">
            <el-select
              v-model="row.binId"
              filterable
              clearable
              :loading="row.binLoading"
              :disabled="!lineBinManaged(row)"
              :placeholder="lineBinManaged(row) ? '选择货位' : '无需货位'"
              style="width: 100%"
              @change="onLineBinChange(row)"
            >
              <el-option v-for="b in row.bins" :key="b.id" :label="b.name || b.code" :value="b.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="批号" width="160">
          <template #default="{ row }">
            <el-select
              v-model="row.batchNo"
              filterable
              clearable
              :loading="row.batchLoading"
              :placeholder="lineBatchRequired(row) ? '选择批号（必选）' : '可选'"
              style="width: 100%"
            >
              <el-option v-for="b in row.batches" :key="b.batchNo" :label="`${b.batchNo}（余 ${b.quantity}）`" :value="b.batchNo" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="returnVisible = false">取消</el-button>
        <el-button type="danger" :loading="returning" @click="submitReturn">提交退货</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.return-detail {
  padding: 8px 16px 8px 48px;
  background: var(--el-fill-color-lighter);
}
</style>
