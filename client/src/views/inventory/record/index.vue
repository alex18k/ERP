<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { stockApi, warehouseApi, materialApi, stockTransactionTypeApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialId: '', warehouseId: '', startDate: '', endDate: '' })

// ===== 增加库存事务 =====
const dialogVisible = ref(false)
const materials = ref<any[]>([])
const transactionTypes = ref<any[]>([])
const form = reactive<any>({ materialId: null, warehouseId: null, quantity: 1, transactionTypeId: null, effectiveDate: todayStr(), remark: '' })

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function loadOptions() {
  const [mRes, tRes] = await Promise.all([
    materialApi.list({ pageSize: 200 }),
    stockTransactionTypeApi.list({ pageSize: 200 }),
  ])
  materials.value = mRes.data.items
  transactionTypes.value = tRes.data.items
}

function openDialog() {
  Object.assign(form, { materialId: null, warehouseId: null, quantity: 1, transactionTypeId: null, effectiveDate: todayStr(), remark: '' })
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
    quantity: form.quantity,
    transactionTypeId: form.transactionTypeId,
    effectiveDate: form.effectiveDate,
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
        <el-button type="primary" @click="openDialog()"><el-icon><Plus /></el-icon>增加</el-button>
        <el-input v-model="query.materialId" placeholder="物料ID" clearable style="width: 90px" />
        <el-select v-model="query.warehouseId" placeholder="仓库" clearable style="width: 150px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-input v-model="query.startDate" type="date" placeholder="开始" clearable style="width: 150px" />
        <el-input v-model="query.endDate" type="date" placeholder="结束" clearable style="width: 150px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialId: '', warehouseId: '', startDate: '', endDate: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
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
        <el-table-column label="物料" min-width="160">
          <template #default="{ row }">{{ row.material?.code }} - {{ row.material?.name }}</template>
        </el-table-column>
        <el-table-column label="库位" width="120">
          <template #default="{ row }">{{ row.warehouse?.name }}</template>
        </el-table-column>
        <el-table-column label="数量" width="100">
          <template #default="{ row }">
            <span :style="{ color: row.quantity < 0 ? 'var(--el-color-danger)' : 'var(--el-color-success)', fontWeight: 600 }">
              {{ row.quantity > 0 ? '+' : '' }}{{ row.quantity }}
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
          <el-select v-model="form.materialId" filterable placeholder="选择物料" style="width: 100%">
            <el-option v-for="m in materials" :key="m.id" :label="`${m.code} - ${m.name}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库" required>
          <el-select v-model="form.warehouseId" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="form.quantity" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="生效日期">
          <el-input v-model="form.effectiveDate" type="date" style="width: 100%" />
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
