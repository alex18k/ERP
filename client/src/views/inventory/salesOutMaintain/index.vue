<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { stockApi, stockTransactionTypeApi, workshopApi, systemApi, customerApi } from '../../../api'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const currentRow = ref<any>(null)
const transactionTypes = ref<any[]>([])
const departments = ref<any[]>([])
const companies = ref<any[]>([])
const customerOptions = ref<any[]>([])
const customerLoading = ref(false)
let salesOutTypeId: any = ''

// ===== 编辑弹窗：只改表头字段，明细行只改备注 =====
const editVisible = ref(false)
const editingDocNo = ref('')
const editSaving = ref(false)
const editForm = reactive({
  effectiveDate: '',
  orderNo: '',
  departmentId: null as number | null,
  salesperson: '',
  keeper: '',
  approver: '',
  mainRemark: '',
  deliveryNo: '',
  contractNo: '',
  address: '',
  contactName: '',
  contactPhone: '',
  companyId: null as number | null,
})
const editItems = ref<any[]>([])

async function searchCustomers(keyword: string) {
  customerLoading.value = true
  try {
    const res: any = await customerApi.options({ keyword: keyword || '', limit: 50 })
    customerOptions.value = res.data || []
  } catch {
    customerOptions.value = []
  } finally {
    customerLoading.value = false
  }
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
      salesperson: first.salesperson || first.handler || '',
      keeper: first.keeper || '',
      approver: first.approver || '',
      mainRemark: first.mainRemark || '',
      deliveryNo: first.deliveryNo || '',
      contractNo: first.contractNo || '',
      address: first.address || '',
      contactName: first.contactName || '',
      contactPhone: first.contactPhone || '',
      companyId: first.companyId ?? null,
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
      salesperson: editForm.salesperson,
      keeper: editForm.keeper,
      approver: editForm.approver,
      mainRemark: editForm.mainRemark,
      deliveryNo: editForm.deliveryNo,
      contractNo: editForm.contractNo,
      contactName: editForm.contactName,
      contactPhone: editForm.contactPhone,
      companyId: editForm.companyId,
      items: editItems.value.map((r: any) => ({ id: r.id, remark: r.remark || '' })),
    })
    ElMessage.success('单据已保存')
    editVisible.value = false
    await loadData()
  } catch { /* error shown by interceptor */ } finally {
    editSaving.value = false
  }
}

const query = reactive({
  page: 1,
  pageSize: 20,
  materialKeyword: '',
  address: '',
  startDate: '',
  endDate: '',
  documentNo: '',
  direction: 'out',
})

function signedQty(row: any) {
  const q = Number(row.quantity) || 0
  const signed = row.type === 'out' ? -q : q
  return signed > 0 ? `+${signed}` : String(signed)
}

// 红单识别：出库流水中数量为负（红字冲销）
function isRed(row: any) {
  return Number(row.quantity) < 0
}

function rowClassName({ row }: any) {
  return isRed(row) ? 'red-row' : ''
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.records({ ...query, transactionTypeId: salesOutTypeId })
    list.value = res.data.items
    total.value = res.data.total
    currentRow.value = null
  } finally {
    loading.value = false
  }
}

function goSalesOut() {
  router.push('/inventory/sales-out')
}

function printDocument(row: any) {
  if (!row?.documentNo) return
  router.push({ path: '/inventory/sales-deliver-print', query: { documentNo: row.documentNo } })
}

// 红单：跳到销售出库录入页按原单调出，数量自动为负
function redDocument(row: any) {
  if (!row?.documentNo) return
  router.push({ path: '/inventory/sales-out', query: { red: row.documentNo } })
}

function printSelected() {
  if (!currentRow.value) return
  printDocument(currentRow.value)
}

function companyName(id: number | null) {
  if (!id) return '-'
  return companies.value.find((c: any) => c.id === id)?.nameZh || '-'
}

function customerName(code: string) {
  if (!code) return '-'
  return customerOptions.value.find((c: any) => c.code === code)?.name || code
}

onMounted(async () => {
  const [tRes, dRes, cRes, cuRes]: any[] = await Promise.all([
    stockTransactionTypeApi.list({ pageSize: 200 }),
    workshopApi.list(),
    systemApi.companies(),
    customerApi.options({ keyword: '', limit: 50 }),
  ])
  transactionTypes.value = (tRes.data.items || []).filter(
    (t: any) => t.status === 1 && t.direction === 'out' && (t.code === 'ISS-SO' || t.description.includes('销售出库')),
  )
  departments.value = (dRes.data || []).filter((d: any) => d.status === 1)
  companies.value = cRes.data || []
  customerOptions.value = cuRes.data || []
  salesOutTypeId = transactionTypes.value[0]?.id || ''
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.documentNo" placeholder="事务单号/源单号" clearable style="width: 160px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-select v-model="query.address" placeholder="收货单位" clearable filterable remote allow-create default-first-option :remote-method="searchCustomers" :loading="customerLoading" style="width: 200px">
          <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.code" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" @keyup.enter="query.page = 1, loadData()" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', address: '', startDate: '', endDate: '', documentNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar" style="justify-content: flex-start">
        <el-button type="success" plain @click="goSalesOut"><el-icon><Upload /></el-icon>销售出库</el-button>
        <el-button type="primary" plain :disabled="!currentRow?.documentNo" @click="printSelected"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button plain :disabled="!currentRow?.documentNo" @click="openEdit(currentRow)"><el-icon><Edit /></el-icon>编辑</el-button>
        <el-button type="danger" plain :disabled="!currentRow?.documentNo" @click="redDocument(currentRow)"><el-icon><DocumentRemove /></el-icon>红单</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe highlight-current-row :row-class-name="rowClassName" max-height="calc(100vh - 260px)" @row-click="(row: any) => (currentRow = row)">
        <el-table-column label="生效日期" width="90">
          <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="事务单号" width="135" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link v-if="row.documentNo" type="primary" :underline="false" @click.stop="printDocument(row)">{{ row.documentNo }}</el-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="行号" width="50" align="center">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="物料编码" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="封装" width="70" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.packageType || '-' }}</template>
        </el-table-column>
        <el-table-column label="库位" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="货位" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bin?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="batchNo" label="批号" width="110" show-overflow-tooltip />
        <el-table-column label="单位" width="60">
          <template #default="{ row }">{{ row.um || row.material?.unit || '-' }}</template>
        </el-table-column>
        <el-table-column label="数量" width="70" align="right">
          <template #default="{ row }">
            <span :style="{ color: Number(signedQty(row)) >= 0 ? 'var(--el-color-success)' : 'var(--el-color-danger)', fontWeight: 600 }">
              {{ signedQty(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="80" align="right">
          <template #default="{ row }">{{ row.price != null ? Number(row.price).toFixed(6) : '-' }}</template>
        </el-table-column>
        <el-table-column label="部门" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="经手人" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.handler || '-' }}</template>
        </el-table-column>
        <el-table-column label="销售员" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.salesperson || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购员" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.buyer || '-' }}</template>
        </el-table-column>
        <el-table-column label="仓管员" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.keeper || '-' }}</template>
        </el-table-column>
        <el-table-column label="审核人" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.approver || '-' }}</template>
        </el-table-column>
        <el-table-column label="合同号" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contractNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="快递单号" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.deliveryNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="收货单位" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ customerName(row.address) }}</template>
        </el-table-column>
        <el-table-column label="联系人" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contactName || '-' }}</template>
        </el-table-column>
        <el-table-column label="联系电话" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contactPhone || '-' }}</template>
        </el-table-column>
        <el-table-column label="所属公司" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ companyName(row.companyId) }}</template>
        </el-table-column>
        <el-table-column label="主备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mainRemark || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="源单号" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="事务类型" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.transactionType?.description || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.createdAt }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="80" show-overflow-tooltip>
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有匹配的销售出库流水" :image-size="56">
            <div class="empty-tip">已限定「销售出库」类事务；可清空单号/物料/日期条件后重试</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <!-- 编辑弹窗：表头可改，明细行仅备注可改 -->
    <el-dialog v-model="editVisible" :title="`编辑销售出库单 ${editingDocNo}`" width="960px" :close-on-click-modal="false">
      <div v-loading="editSaving">
        <div class="edit-grid">
          <div class="edit-field"><span class="edit-label">生效日期</span><el-input v-model="editForm.effectiveDate" type="date" style="width: 140px" /></div>
          <div class="edit-field"><span class="edit-label">源单号</span><el-input v-model="editForm.orderNo" style="width: 130px" /></div>
          <div class="edit-field"><span class="edit-label">部门</span>
            <el-select v-model="editForm.departmentId" clearable filterable placeholder="选择部门" style="width: 140px">
              <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id" />
            </el-select>
          </div>
          <div class="edit-field"><span class="edit-label">销售员</span><el-input v-model="editForm.salesperson" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">仓管员</span><el-input v-model="editForm.keeper" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">审核人</span><el-input v-model="editForm.approver" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">快递单号</span><el-input v-model="editForm.deliveryNo" style="width: 150px" /></div>
          <div class="edit-field"><span class="edit-label">合同号</span><el-input v-model="editForm.contractNo" style="width: 130px" /></div>
          <div class="edit-field"><span class="edit-label">收货单位</span>
            <el-input :model-value="customerName(editForm.address)" disabled style="width: 220px" />
          </div>
          <div class="edit-field"><span class="edit-label">联系人</span><el-input v-model="editForm.contactName" style="width: 110px" /></div>
          <div class="edit-field"><span class="edit-label">联系电话</span><el-input v-model="editForm.contactPhone" style="width: 130px" /></div>
          <div class="edit-field"><span class="edit-label">所属公司</span>
            <el-select v-model="editForm.companyId" clearable filterable placeholder="选择所属公司" style="width: 200px">
              <el-option v-for="c in companies" :key="c.id" :label="c.nameZh" :value="c.id" />
            </el-select>
          </div>
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
          <el-table-column label="单价" width="90" align="right"><template #default="{ row }">{{ row.price != null ? Number(row.price).toFixed(6) : '-' }}</template></el-table-column>
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
  grid-template-columns: repeat(6, minmax(0, 1fr));
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
  grid-column: span 3;
}
.edit-label {
  width: 60px;
  text-align: right;
  font-size: 13px;
  color: var(--el-text-color-regular);
  flex: none;
}
</style>
