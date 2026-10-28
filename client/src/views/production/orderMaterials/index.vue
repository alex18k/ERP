<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi } from '../../../api'
import QueryConditionBuilder from '../../../components/QueryConditionBuilder.vue'
import { createEmptyCondition, serializeConditions, type QueryCondition, type QueryField } from '../../../utils/queryBuilder'

const router = useRouter()

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, conditions: undefined as string | undefined })

// ===== 高级查询 =====
const advancedConditions = ref<QueryCondition[]>([createEmptyCondition()])
const queryFields: QueryField[] = [
  { field: 'orderNo', label: '生产订单号', type: 'text', placeholder: '生产订单号' },
  {
    field: 'orderStatus',
    label: '生产订单状态',
    type: 'enum',
    options: [
      { label: '已计划', value: 'planned' },
      { label: '生产中', value: 'in_progress' },
      { label: '已关闭', value: 'closed' },
    ],
  },
  {
    field: 'execStatus',
    label: '执行状态',
    type: 'enum',
    options: [
      { label: '未排产', value: 'none' },
      { label: '待开工', value: 'pending' },
      { label: '生产中', value: 'in_progress' },
      { label: '已完成', value: 'completed' },
      { label: '已关闭', value: 'closed' },
    ],
  },
  { field: 'planner', label: '计划员', type: 'text', placeholder: '计划员' },
  { field: 'releaseDate', label: '下达日期', type: 'date' },
  { field: 'planStartDate', label: '计划开始', type: 'date' },
  { field: 'planEndDate', label: '计划结束', type: 'date' },
  { field: 'productCode', label: '产品编码', type: 'text', placeholder: '生产订单的产品物料编码' },
  { field: 'productSpecification', label: '产品规格型号', type: 'text', placeholder: '生产订单的产品规格型号' },
  { field: 'quantity', label: '数量', type: 'number' },
  { field: 'receivedQty', label: '已入库', type: 'number' },
  { field: 'materialCode', label: '领料物料编码', type: 'text', placeholder: '领料物料编码' },
  { field: 'materialName', label: '领料物料名称', type: 'text', placeholder: '领料物料名称' },
  { field: 'specification', label: '领料物料规格型号', type: 'text', placeholder: '领料物料规格型号' },
  {
    field: 'category',
    label: '分类',
    type: 'enum',
    options: [
      { label: '采购', value: 'purchase' },
      { label: '制造', value: 'manufacture' },
    ],
  },
  { field: 'requiredQty', label: '需求量', type: 'number' },
  { field: 'issuedQty', label: '已领料', type: 'number' },
  { field: 'cancelledQty', label: '已取消', type: 'number' },
  { field: 'unit', label: '单位', type: 'text', placeholder: '单位' },
  {
    field: 'status',
    label: '领料状态',
    type: 'enum',
    options: [
      { label: '待领料', value: 'pending' },
      { label: '部分领料', value: 'partial' },
      { label: '已领料', value: 'issued' },
    ],
  },
  { field: 'remark', label: '备注', type: 'text', placeholder: '备注' },
]

const orderStatusOptions = [
  { label: '已计划', value: 'planned', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已关闭', value: 'closed', type: 'info' },
]
function orderStatusLabel(s: string) {
  return orderStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function orderStatusType(s: string) {
  return orderStatusOptions.find((o) => o.value === s)?.type || 'info'
}

const execStatusOptions = [
  { label: '未排产', value: 'none', type: 'info' },
  { label: '待开工', value: 'pending', type: 'info' },
  { label: '生产中', value: 'in_progress', type: 'warning' },
  { label: '已完成', value: 'completed', type: 'success' },
  { label: '已关闭', value: 'closed', type: 'info' },
]
function execStatusLabel(s: string) {
  return execStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function execStatusType(s: string) {
  return execStatusOptions.find((o) => o.value === s)?.type || 'info'
}

const issueStatusOptions = [
  { label: '待领料', value: 'pending', type: 'info' },
  { label: '部分领料', value: 'partial', type: 'warning' },
  { label: '已领料', value: 'issued', type: 'success' },
]
function issueStatusLabel(s: string) {
  return issueStatusOptions.find((o) => o.value === s)?.label || s || '-'
}
function issueStatusType(s: string) {
  return issueStatusOptions.find((o) => o.value === s)?.type || 'info'
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.orderMaterials(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function submitAdvanced(conditions: QueryCondition[]) {
  query.conditions = serializeConditions(conditions)
  query.page = 1
  loadData()
}

function resetAdvanced() {
  advancedConditions.value = [createEmptyCondition()]
  query.conditions = undefined
  query.page = 1
  loadData()
}

// 工具栏编辑作用于当前选中行，跳转到生产领料单页面编辑该生产订单的物料
const currentRow = ref<any | null>(null)
function onCurrentChange(row: any | null) {
  currentRow.value = row
}
function handleToolbarEdit() {
  if (!currentRow.value) {
    ElMessage.warning('请先在表格中选择一行')
    return
  }
  const orderNo = currentRow.value.productionOrder?.orderNo
  if (!orderNo) {
    ElMessage.warning('该明细行没有关联的生产订单')
    return
  }
  router.push({ path: '/production/work-order-materials', query: { orderNo } })
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产订单物料清单</span>
        <div style="flex: 1" />
        <el-button type="primary" plain :disabled="!currentRow" @click="handleToolbarEdit"><el-icon><Edit /></el-icon>编辑&amp;打印</el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="advanced-query">
        <QueryConditionBuilder v-model="advancedConditions" :fields="queryFields" @query="submitAdvanced" @reset="resetAdvanced" />
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 300px)" highlight-current-row @current-change="onCurrentChange">
        <el-table-column label="生产订单">
          <el-table-column label="生产订单号" width="150" fixed="left">
            <template #default="{ row }">{{ row.productionOrder?.orderNo || '-' }}</template>
          </el-table-column>
          <el-table-column label="物料编码" width="130">
            <template #default="{ row }">{{ row.productionOrder?.material?.code || '-' }}</template>
          </el-table-column>
          <el-table-column label="规格型号" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.productionOrder?.material?.specification || '-' }}</template>
          </el-table-column>
          <el-table-column label="数量" width="90" align="right">
            <template #default="{ row }">{{ row.productionOrder?.quantity ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="已入库" width="90" align="right">
            <template #default="{ row }">{{ row.productionOrder?.receivedQty ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="计划周期" width="190">
            <template #default="{ row }">
              <span v-if="row.productionOrder?.planStartDate">{{ String(row.productionOrder.planStartDate).slice(0, 10) }} ~ {{ String(row.productionOrder.planEndDate || '').slice(0, 10) }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="下达日期" width="110">
            <template #default="{ row }">{{ row.productionOrder?.releaseDate ? String(row.productionOrder.releaseDate).slice(0, 10) : '-' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="orderStatusType(row.productionOrder?.status)" size="small" effect="plain">{{ orderStatusLabel(row.productionOrder?.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="执行状态" width="100">
            <template #default="{ row }">
              <el-tag :type="execStatusType(row.productionOrder?.execStatus)" size="small">{{ execStatusLabel(row.productionOrder?.execStatus) }}</el-tag>
            </template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="物料清单">
          <el-table-column label="物料编码" width="130">
            <template #default="{ row }">{{ row.material?.code || '-' }}</template>
          </el-table-column>
          <el-table-column label="物料名称" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.material?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="型号规格" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.material?.specification || '-' }}</template>
          </el-table-column>
          <el-table-column prop="requiredQty" label="需求量" width="100" align="right" />
          <el-table-column prop="issuedQty" label="已领料" width="90" align="right" />
          <el-table-column prop="cancelledQty" label="已取消" width="90" align="right" />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column label="领料状态" width="100">
            <template #default="{ row }">
              <el-tag :type="issueStatusType(row.status)" size="small">{{ issueStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark || '-' }}</template>
          </el-table-column>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的物料清单" :image-size="56">
            <div class="empty-tip">平铺展示所有生产订单的物料清单；可用上方高级查询按订单、物料或领料状态筛选</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
