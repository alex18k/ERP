<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { stockApi, warehouseApi, stockTransactionTypeApi, workshopApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const warehouses = ref<any[]>([])
const transactionTypes = ref<any[]>([])
const departments = ref<any[]>([])
let allowedTypeIds: number[] = []

// ===== 编辑弹窗：只改表头字段，明细行只改备注 =====
const editVisible = ref(false)
const editingDocNo = ref('')
const editSaving = ref(false)
const editForm = reactive({
  effectiveDate: '',
  orderNo: '',
  departmentId: null as number | null,
  handler: '',
  keeper: '',
  approver: '',
  mainRemark: '',
})
const editItems = ref<any[]>([])
const query = reactive({
  page: 1,
  pageSize: 20,
  materialKeyword: '',
  warehouseId: '',
  transactionTypeId: '',
  startDate: '',
  endDate: '',
  documentNo: '',
  direction: 'in',
})

function signedQty(row: any) {
  const q = Number(row.quantity) || 0
  const signed = row.type === 'out' ? -q : q
  return signed > 0 ? `+${signed}` : String(signed)
}

// 红单识别：入库流水中数量为负（红字冲销）
function rowClassName({ row }: any) {
  return Number(row.quantity) < 0 ? 'red-row' : ''
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.records({
      ...query,
      transactionTypeIds: query.transactionTypeId ? '' : allowedTypeIds.join(','),
    })
    list.value = res.data.items
    total.value = res.data.total
    currentRow.value = null
  } finally {
    loading.value = false
  }
}

function goProductIn() {
  router.push('/inventory/product-in')
}

function printDocument(row: any) {
  if (!row?.documentNo) return
  router.push({ path: '/inventory/product-in-print', query: { documentNo: row.documentNo } })
}

function printSelected() {
  if (!currentRow.value) return
  printDocument(currentRow.value)
}

// 红单：跳到产品入库录入页按原单调出，数量自动为负
function redDocument(row: any) {
  if (!row?.documentNo) return
  router.push({ path: '/inventory/product-in', query: { red: row.documentNo } })
}

async function openEdit(row: any) {
  const docNo = row?.documentNo
  if (!docNo) return
  editingDocNo.value = docNo
  try {
    const res: any = await stockApi.recordsByDocument(docNo)
    const items = res.data.items || []
    if (items.length === 0) {
      ElMessage.warning('单据不存在或无流水')
      return
    }
    const first = items[0]
    Object.assign(editForm, {
      effectiveDate: first.effectiveDate ? String(first.effectiveDate).slice(0, 10) : '',
      orderNo: first.orderNo || '',
      departmentId: first.departmentId ?? null,
      handler: first.handler || '',
      keeper: first.keeper || '',
      approver: first.approver || '',
      mainRemark: first.mainRemark || '',
    })
    editItems.value = items
    editVisible.value = true
  } catch { /* error shown by interceptor */ }
}

async function saveEdit() {
  editSaving.value = true
  try {
    await stockApi.updateRecordsByDocument(editingDocNo.value, {
      effectiveDate: editForm.effectiveDate || null,
      orderNo: editForm.orderNo,
      departmentId: editForm.departmentId,
      handler: editForm.handler,
      keeper: editForm.keeper,
      approver: editForm.approver,
      mainRemark: editForm.mainRemark,
      items: editItems.value.map((r: any) => ({ id: r.id, remark: r.remark || '' })),
    })
    ElMessage.success('单据已保存')
    editVisible.value = false
    await loadData()
  } catch { /* error shown by interceptor */ } finally {
    editSaving.value = false
  }
}

onMounted(async () => {
  const [wRes, tRes, dRes]: any[] = await Promise.all([
    warehouseApi.list({ pageSize: 200 }),
    stockTransactionTypeApi.list({ pageSize: 200, status: 1 }),
    workshopApi.list(),
  ])
  warehouses.value = wRes.data.items || []
  transactionTypes.value = (tRes.data.items || []).filter(
    (t: any) => t.status === 1 && t.direction === 'in' && (t.code === 'RCT-MC' || t.description === '自制加工'),
  )
  allowedTypeIds = transactionTypes.value.map((t: any) => t.id)
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  query.transactionTypeId = transactionTypes.value[0]?.id ?? ''
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.documentNo" placeholder="事务单号/源单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="产品编码/名称" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-select v-model="query.transactionTypeId" placeholder="事务类型" clearable filterable style="width: 160px">
          <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description || t.code" :value="t.id" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', transactionTypeId: transactionTypes[0]?.id || '', startDate: '', endDate: '', documentNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar" style="justify-content: flex-start">
        <el-button type="success" plain @click="goProductIn"><el-icon><Download /></el-icon>产品入库</el-button>
        <el-button type="primary" plain :disabled="!currentRow?.documentNo" @click="printSelected"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button plain :disabled="!currentRow?.documentNo" @click="openEdit(currentRow)"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button type="danger" plain :disabled="!currentRow?.documentNo" @click="redDocument(currentRow)"><el-icon><DocumentRemove /></el-icon>红单</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row :row-class-name="rowClassName" max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="生效日期" width="100">
          <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="事务单号" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.documentNo" type="primary" :underline="false" @click.stop="printDocument(row)">{{ row.documentNo }}</el-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="源单号" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="行号" width="56" align="center">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="事务类型" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.transactionType?.description || '-' }}</template>
        </el-table-column>
        <el-table-column label="产品编码" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="产品名称" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="封装" width="80" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.packageType || '-' }}</template>
        </el-table-column>
        <el-table-column label="库位" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="batchNo" label="批号" width="130" show-overflow-tooltip />
        <el-table-column label="数量" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: Number(signedQty(row)) >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)', fontWeight: 600 }">
              {{ signedQty(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="部门" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="入库人" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.handler || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓管员" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.keeper || '-' }}</template>
        </el-table-column>
        <el-table-column label="审核人" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.approver || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.createdAt }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的产品入库流水" :image-size="56">
            <div class="empty-tip">已限定「自制加工」类事务；可清空条件后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <!-- 编辑弹窗：表头可改，明细行仅备注可改 -->
    <el-dialog v-model="editVisible" :title="`编辑产品入库单 ${editingDocNo}`" width="1200px" :close-on-click-modal="false">
      <div v-loading="editSaving">
        <div class="edit-grid">
          <div class="edit-field"><span class="edit-label">生效日期</span><el-input v-model="editForm.effectiveDate" type="date" style="width: 140px" /></div>
          <div class="edit-field"><span class="edit-label">源单号</span><el-input v-model="editForm.orderNo" style="width: 130px" /></div>
          <div class="edit-field"><span class="edit-label">部门</span>
            <el-select v-model="editForm.departmentId" clearable filterable placeholder="选择部门" style="width: 140px">
              <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id" />
            </el-select>
          </div>
          <div class="edit-field"><span class="edit-label">入库人</span><el-input v-model="editForm.handler" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">仓管员</span><el-input v-model="editForm.keeper" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">审核人</span><el-input v-model="editForm.approver" style="width: 110px" /></div>
          <div class="edit-field edit-field--wide"><span class="edit-label">主备注</span><el-input v-model="editForm.mainRemark" style="width: 400px" /></div>
        </div>

        <el-table :data="editItems" size="small" border max-height="360px">
          <el-table-column label="行号" width="56" align="center"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
          <el-table-column label="物料编码" width="100" show-overflow-tooltip><template #default="{ row }">{{ row.material?.code }}</template></el-table-column>
          <el-table-column label="物料名称" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.material?.name }}</template></el-table-column>
          <el-table-column label="型号规格" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ row.material?.specification || '-' }}</template></el-table-column>
          <el-table-column label="仓库/货位" width="130" show-overflow-tooltip><template #default="{ row }">{{ row.warehouse?.name }}{{ row.bin ? ' / ' + row.bin.name : '' }}</template></el-table-column>
          <el-table-column label="批号" width="110" show-overflow-tooltip><template #default="{ row }">{{ row.batchNo || '-' }}</template></el-table-column>
          <el-table-column label="单位" width="60"><template #default="{ row }">{{ row.um || row.material?.unit || '-' }}</template></el-table-column>
          <el-table-column label="数量" width="80" align="right"><template #default="{ row }">{{ signedQty(row) }}</template></el-table-column>
          <el-table-column label="备注（可改）" min-width="160">
            <template #default="{ row }"><el-input v-model="row.remark" placeholder="行备注" /></template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 红单行：淡红底提示（需覆盖斑马纹背景） */
:deep(.el-table .red-row td.el-table__cell),
:deep(.el-table .red-row.el-table__row--striped td.el-table__cell) {
  background: #fdf2f2 !important;
}
.edit-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px 10px;
  margin-bottom: 10px;
}
.edit-field {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.edit-field--wide {
  grid-column: span 2;
}
.edit-label {
  width: 60px;
  text-align: right;
  font-size: 13px;
  color: var(--el-text-color-regular);
  flex: none;
}
</style>
