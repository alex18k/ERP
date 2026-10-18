<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { purchaseApi, stockApi, workshopApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, receiptNo: '', orderNo: '', materialKeyword: '', startDate: '', endDate: '' })

const departments = ref<any[]>([])
const handlerOptions = ref<string[]>([])

const returnVisible = ref(false)
const returning = ref(false)
const currentDoc = ref<any>(null)
const returnLines = ref<any[]>([])
const returnForm = reactive({
  effectiveDate: todayStr(),
  departmentId: null as number | null,
  handler: '',
  remark: '',
})

const hasReturnQty = computed(() => returnLines.value.some((l: any) => Number(l.returnQty) > 0))

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

function rowClassName({ row }: any) {
  return (row.returns?.length ?? 0) > 0 ? '' : 'no-return-row'
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
    const res: any = await purchaseApi.receiptDocuments(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  const [dRes, hRes]: any[] = await Promise.all([workshopApi.list(), stockApi.handlers()])
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  handlerOptions.value = hRes.data || []
}

function openReturn(row: any) {
  if (fmtQty(row.returnableQty) <= 0) {
    ElMessage.warning('该收货单已全部退货')
    return
  }
  currentDoc.value = row
  returnLines.value = (row.items || []).map((l: any) => ({ ...l, returnQty: 0 }))
  returnForm.effectiveDate = todayStr()
  returnForm.departmentId = null
  returnForm.handler = ''
  returnForm.remark = ''
  returnVisible.value = true
  loadOptions().catch(() => {})
}

function toggleFill() {
  const fill = !hasReturnQty.value
  for (const line of returnLines.value) {
    line.returnQty = fill ? fmtQty(line.returnableQty) : 0
  }
}

async function submitReturn() {
  const doc = currentDoc.value
  if (!doc) return
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
    if (Number(line.returnQty) > fmtQty(line.returnableQty) + 1e-6) {
      ElMessage.warning(`${line.material?.code || ''} 退货数量不能超过可退数量 ${line.returnableQty}`)
      return
    }
  }
  returning.value = true
  try {
    const res: any = await purchaseApi.returnReceiptDocument(doc.documentNo, {
      items: lines.map((l: any) => ({ recordId: l.id, quantity: l.returnQty })),
      effectiveDate: returnForm.effectiveDate || undefined,
      departmentId: returnForm.departmentId || undefined,
      handler: returnForm.handler || undefined,
      remark: returnForm.remark || undefined,
    })
    ElMessage.success(res.data?.documentNo ? `退货成功，退货单号 ${res.data.documentNo}` : '退货成功')
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
        <el-input v-model="query.receiptNo" placeholder="收货单号" clearable style="width: 160px" />
        <el-input v-model="query.orderNo" placeholder="采购单号" clearable style="width: 160px" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称/规格" clearable style="width: 190px" />
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { receiptNo: '', orderNo: '', materialKeyword: '', startDate: '', endDate: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)" :row-class-name="rowClassName">
        <el-table-column type="expand" width="40">
          <template #default="{ row }">
            <div class="return-detail">
              <el-table :data="row.returns" size="small" border>
                <el-table-column label="退货单号" width="150">
                  <template #default="{ row: r }">{{ r.documentNo || '-' }}</template>
                </el-table-column>
                <el-table-column label="退货日期" width="110">
                  <template #default="{ row: r }">{{ dateOnly(r.effectiveDate || r.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="物料编码" width="110" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.material?.code }}</template>
                </el-table-column>
                <el-table-column label="物料名称" min-width="130" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.material?.name }}</template>
                </el-table-column>
                <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.material?.specification || '-' }}</template>
                </el-table-column>
                <el-table-column label="退货数量" width="90" align="right">
                  <template #default="{ row: r }">{{ r.quantity }}</template>
                </el-table-column>
                <el-table-column label="单位" width="70">
                  <template #default="{ row: r }">{{ r.material?.unit || '-' }}</template>
                </el-table-column>
                <el-table-column label="批号" width="120" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.batchNo || '-' }}</template>
                </el-table-column>
                <el-table-column label="仓库" width="100" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.warehouseName || '-' }}</template>
                </el-table-column>
                <el-table-column label="货位" width="90" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.binName || '-' }}</template>
                </el-table-column>
                <el-table-column label="部门" width="100" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.departmentName || '-' }}</template>
                </el-table-column>
                <el-table-column label="经手人" width="90" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.handler || '-' }}</template>
                </el-table-column>
                <el-table-column label="操作员" width="90" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.operatorName || '-' }}</template>
                </el-table-column>
                <el-table-column label="备注" min-width="120" show-overflow-tooltip>
                  <template #default="{ row: r }">{{ r.remark || '-' }}</template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="收货日期" width="110">
          <template #default="{ row }">{{ dateOnly(row.effectiveDate) }}</template>
        </el-table-column>
        <el-table-column label="收货单号" width="160">
          <template #default="{ row }">{{ row.documentNo }}</template>
        </el-table-column>
        <el-table-column label="送货单号" width="140">
          <template #default="{ row }">{{ row.deliveryNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购单号" width="160">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="供应商" min-width="150">
          <template #default="{ row }">{{ row.supplierName || '未指定' }}</template>
        </el-table-column>
        <el-table-column label="行数" width="70" align="center">
          <template #default="{ row }">{{ row.lineCount ?? row.items?.length ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="收货数量" width="100" align="right">
          <template #default="{ row }">{{ row.totalQty }}</template>
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
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="returnVisible" :title="`采购退货 - ${currentDoc?.documentNo || ''}`" width="1150px" destroy-on-close :close-on-click-modal="false">
      <el-descriptions :column="4" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="收货单号">{{ currentDoc?.documentNo }}</el-descriptions-item>
        <el-descriptions-item label="采购单号">{{ currentDoc?.orderNo || '-' }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ currentDoc?.supplierName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="送货单号">{{ currentDoc?.deliveryNo || '-' }}</el-descriptions-item>
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
        <el-button size="small" @click="toggleFill">{{ hasReturnQty ? '清空' : '自动' }}</el-button>
      </div>

      <el-table :data="returnLines" size="small" border max-height="400">
        <el-table-column label="行号" width="60" align="center">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
        </el-table-column>
        <el-table-column label="收货数量" width="90" align="right">
          <template #default="{ row }">{{ row.quantity }}</template>
        </el-table-column>
        <el-table-column label="已退数量" width="90" align="right">
          <template #default="{ row }">{{ row.returnedQty }}</template>
        </el-table-column>
        <el-table-column label="可退数量" width="90" align="right">
          <template #default="{ row }">{{ row.returnableQty }}</template>
        </el-table-column>
        <el-table-column label="本次退货" width="110">
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
        <el-table-column label="单位" width="70">
          <template #default="{ row }">{{ row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="批号" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.batchNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="货位" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="returnVisible = false">取消</el-button>
        <el-button type="danger" :loading="returning" @click="submitReturn">确认退货</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.return-detail {
  padding: 8px 16px 8px 48px;
  background: var(--el-fill-color-lighter);
}
:deep(.no-return-row .el-table__expand-icon) {
  visibility: hidden;
  pointer-events: none;
}
</style>
