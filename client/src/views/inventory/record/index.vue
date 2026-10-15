<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { stockApi, warehouseApi, materialApi, stockTransactionTypeApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialKeyword: '', warehouseId: '', transactionTypeId: '', startDate: '', endDate: '', documentNo: '' })

// ===== 增加库存事务 =====
const dialogVisible = ref(false)
const materials = ref<any[]>([])
const materialLoading = ref(false)
const materialMap = new Map<number, any>()
const transactionTypes = ref<any[]>([])
const form = reactive<any>({ materialId: null, warehouseId: null, batchNo: '', quantity: 1, unit: '', transactionTypeId: null, effectiveDate: todayStr(), documentNo: '', lineNo: null, remark: '' })

// 选定物料的可用计量单位（基本单位 + 转换单位）
const selectedMaterial = computed(() => (form.materialId ? materialMap.get(form.materialId) : null))
const unitOptions = computed<string[]>(() => {
  const m = selectedMaterial.value
  const set = new Set<string>(['个', '件', '套', '台', '只', '箱', '包'])
  if (m?.units) for (const u of m.units) set.add(u)
  if (form.unit) set.add(form.unit)
  return [...set]
})
const baseHint = computed(() => {
  const m = selectedMaterial.value
  if (!m?.unit || !form.unit || form.unit === m.unit) return ''
  const rate = m.unitRates?.[form.unit] ?? 0
  if (!rate) return ''
  return `= ${Number(((Number(form.quantity) || 0) * rate).toFixed(6))} ${m.unit}`
})

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function registerMaterials(items: any[]) {
  for (const m of items) if (m?.id) materialMap.set(m.id, m)
  // 下拉仅显示本次结果 + 当前已选物料（el-select remote 模式不做本地过滤）
  const selected = form.materialId ? materialMap.get(form.materialId) : null
  const seen = new Set<number>()
  materials.value = [...items, ...(selected ? [selected] : [])].filter((m: any) => {
    if (!m?.id || seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

async function searchMaterials(keyword: string) {
  materialLoading.value = true
  try {
    const res: any = await materialApi.options({ keyword, limit: 50 })
    registerMaterials(res.data || [])
  } catch {
    /* ignore */
  } finally {
    materialLoading.value = false
  }
}

async function loadOptions() {
  const [mRes, tRes]: any[] = await Promise.all([
    materialApi.options({ limit: 50 }),
    stockTransactionTypeApi.list({ pageSize: 200 }),
  ])
  registerMaterials(mRes.data || [])
  transactionTypes.value = tRes.data.items
}

function openDialog() {
  Object.assign(form, { materialId: null, warehouseId: null, batchNo: '', quantity: 1, unit: '', transactionTypeId: null, effectiveDate: todayStr(), documentNo: '', lineNo: null, remark: '' })
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.transactionTypeId) { ElMessage.warning('请选择事务类型'); return }
  if (!form.materialId) { ElMessage.warning('请选择物料'); return }
  if (!form.warehouseId) { ElMessage.warning('请选择仓库'); return }
  if (form.quantity <= 0) { ElMessage.warning('数量必须大于0'); return }

  const tt = transactionTypes.value.find((t) => t.id === form.transactionTypeId)
  const payload = {
    materialId: form.materialId,
    warehouseId: form.warehouseId,
    batchNo: form.batchNo || undefined,
    quantity: form.quantity,
    unit: form.unit || undefined,
    transactionTypeId: form.transactionTypeId,
    effectiveDate: form.effectiveDate,
    documentNo: form.documentNo || undefined,
    lineNo: form.lineNo ?? undefined,
    remark: form.remark,
  }

  try {
    if ((tt?.direction || 'in') === 'in') {
      await stockApi.in(payload)
      ElMessage.success('入库成功')
    } else {
      await stockApi.out(payload)
      ElMessage.success('出库成功')
    }
    dialogVisible.value = false
    loadData()
  } catch { /* error shown by interceptor */ }
}

function signedQty(row: any) {
  if (row.type === 'out') return `-${row.quantity}`
  if (row.type === 'in') return `+${row.quantity}`
  return String(row.quantity)
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await stockApi.records(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

onMounted(async () => {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
  await loadOptions()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-button type="success" plain class="btn-add" @click="openDialog()"><el-icon><Plus /></el-icon>增加</el-button>
        <el-input v-model="query.documentNo" placeholder="单号" clearable style="width: 150px" />
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-select v-model="query.transactionTypeId" placeholder="事务类型" clearable filterable style="width: 160px">
          <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description || t.code" :value="t.id" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', warehouseId: '', transactionTypeId: '', startDate: '', endDate: '', documentNo: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column label="生效日期" width="120">
          <template #default="{ row }">{{ row.effectiveDate?.slice(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="单号" width="150">
          <template #default="{ row }">{{ row.documentNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="行号" width="70">
          <template #default="{ row }">{{ row.lineNo ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="事务类型" width="170">
          <template #default="{ row }">
            <span v-if="row.transactionType">{{ row.transactionType.description }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="物料编码" width="110">
          <template #default="{ row }">{{ row.material?.code }}</template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="140">
          <template #default="{ row }">{{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="型号规格" min-width="130">
          <template #default="{ row }">{{ row.material?.specification }}</template>
        </el-table-column>
        <el-table-column label="库位" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column prop="batchNo" label="批号" width="150" />
        <el-table-column label="数量" width="100">
          <template #default="{ row }">
            <span :style="{ color: row.type === 'out' ? 'var(--el-color-danger)' : 'var(--el-color-success)', fontWeight: 600 }">
              {{ signedQty(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="90">
          <template #default="{ row }">{{ row.balanceAfter }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="100">
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140">
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ row.createdAt }}</template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <!-- 增加库存事务 -->
    <el-dialog v-model="dialogVisible" title="库存事务" width="480px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="事务类型" required>
          <el-select v-model="form.transactionTypeId" filterable placeholder="选择事务类型（决定增/减）" style="width: 100%">
            <el-option v-for="t in transactionTypes" :key="t.id" :label="t.description" :value="t.id">
              <span>{{ t.description }}</span>
              <el-tag size="small" :type="t.direction === 'in' ? 'success' : 'danger'" style="float: right; margin-top: 5px">{{ t.direction === 'in' ? '增' : '减' }}</el-tag>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="物料" required>
          <el-select v-model="form.materialId" filterable remote reserve-keyword :remote-method="searchMaterials" :loading="materialLoading" placeholder="输入编码/名称搜索物料" style="width: 100%">
            <el-option v-for="m in materials" :key="m.id" :label="`${m.code} - ${m.name}${m.specification ? ' / ' + m.specification : ''}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouseId" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="批号">
          <el-input v-model="form.batchNo" placeholder="启用批号管理的物料必填/出库必填；入库不填自动生成" />
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.quantity" :min="1" style="width: 100%" />
          <div v-if="baseHint" class="unit-hint">{{ baseHint }}</div>
        </el-form-item>
        <el-form-item label="计量单位">
          <el-select v-model="form.unit" filterable allow-create default-first-option clearable placeholder="默认基本单位" style="width: 100%">
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="生效日期">
          <el-input v-model="form.effectiveDate" type="date" style="width: 100%" />
        </el-form-item>
        <el-form-item label="单号">
          <el-input v-model="form.documentNo" placeholder="留空自动生成" clearable />
        </el-form-item>
        <el-form-item label="行号">
          <el-input-number v-model="form.lineNo" :min="1" :controls="false" placeholder="默认1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.unit-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
