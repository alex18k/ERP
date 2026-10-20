<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stockApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const records = ref<any[]>([])
const loading = ref(false)

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))

const documentNo = computed(() => String(route.query.documentNo || '').trim())
const preferredTypeId = computed(() => Number(route.query.typeId) || null)

const uniq = (vals: (string | undefined | null)[]) => [...new Set(vals.filter(Boolean) as string[])]

const currentType = computed(() => {
  const preferred = preferredTypeId.value
    ? records.value.find((r) => r.transactionTypeId === preferredTypeId.value)?.transactionType
    : null
  return preferred || records.value[0]?.transactionType || null
})

const title = computed(() => `${currentType.value?.description || '库存事务'}单`)
const hasMultipleTypes = computed(() => new Set(records.value.map((r) => r.transactionTypeId ?? 0)).size > 1)
const hasBatch = computed(() => records.value.some((r) => !!r.batchNo))

const doc = computed(() => {
  const first = records.value[0] || {}
  return {
    orderNo: records.value.find((r) => r.orderNo)?.orderNo || '',
    effectiveDate: first.effectiveDate || first.createdAt,
    typeLabel: currentType.value?.description || '库存事务',
    warehouses: uniq(records.value.map((r) => r.warehouse?.name)).join('、') || '-',
    handler: uniq(records.value.map((r) => r.handler)).join('、'),
    departments: uniq(records.value.map((r) => r.department?.name)).join('、') || '-',
    keeper: uniq(records.value.map((r) => r.keeper)).join('、'),
    approver: uniq(records.value.map((r) => r.approver)).join('、'),
    operators: uniq(records.value.map((r) => r.operator?.realName || r.operator?.username)).join('、') || '-',
    remark: records.value.find((r) => r.remark)?.remark || '',
  }
})

const cnDate = computed(() => {
  const v = doc.value.effectiveDate
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

const inboundQty = computed(() => records.value.filter((r) => r.type === 'in').reduce((s, r) => s + Number(r.quantity || 0), 0))
const outboundQty = computed(() => records.value.filter((r) => r.type === 'out').reduce((s, r) => s + Number(r.quantity || 0), 0))

const totalText = computed(() => {
  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (inboundQty.value > 0 && outboundQty.value > 0) {
    return `${fmt(inboundQty.value)} / ${fmt(outboundQty.value)}`
  }
  if (outboundQty.value > 0) return fmt(outboundQty.value)
  return fmt(inboundQty.value)
})

function signedQty(row: any) {
  const q = Number(row.quantity) || 0
  const signed = row.type === 'out' ? -q : q
  return signed > 0 ? `+${signed}` : String(signed)
}

async function loadData() {
  if (!documentNo.value) return
  loading.value = true
  try {
    const res: any = await stockApi.recordsByDocument(documentNo.value)
    records.value = res.data.items || []
  } finally {
    loading.value = false
  }
}

function doPrint() {
  window.print()
}

onMounted(() => {
  loadCompanyInfo()
  loadData()
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" :disabled="records.length === 0" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="sheet-wrap">
      <div v-if="records.length > 0" id="print-area" class="sheet">
        <div class="page-no">第1页共1页</div>
        <div class="company">{{ companyName }}</div>
        <div class="doc-title">{{ title }}</div>

        <div class="meta">
          <div class="meta-item"><b>单据日期</b>：{{ cnDate }}</div>
          <div class="meta-item"><b>单据编号</b>：{{ documentNo }}</div>
          <div class="meta-item"><b>事务类型</b>：{{ doc.typeLabel }}</div>
          <div class="meta-item"></div>
          <div class="meta-item"><b>源单号</b>：{{ doc.orderNo || '-' }}</div>
          <div class="meta-item"><b>仓库</b>：{{ doc.warehouses }}</div>
          <div class="meta-item"><b>部门</b>：{{ doc.departments }}</div>
          <div class="meta-item"><b>经手人</b>：{{ doc.handler || '____________' }}</div>
          <div class="meta-item"><b>操作员</b>：{{ doc.operators }}</div>
          <div class="meta-item"><b>打印日期</b>：{{ todayStr }}</div>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th style="width: 44px">序号</th>
              <th v-if="hasMultipleTypes" style="width: 96px">事务类型</th>
              <th style="width: 100px">物料编码</th>
              <th style="width: 110px">物料名称</th>
              <th style="width: 90px">品牌</th>
              <th>规格型号</th>
              <th style="width: 54px">单位</th>
              <th v-if="hasBatch" style="width: 120px">批号</th>
              <th style="width: 86px">数量</th>
              <th style="width: 110px">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, idx) in records" :key="it.id">
              <td class="c">{{ it.lineNo ?? idx + 1 }}</td>
              <td v-if="hasMultipleTypes">{{ it.transactionType?.description || '-' }}</td>
              <td>{{ it.material?.code }}</td>
              <td>{{ it.material?.name }}</td>
              <td>{{ it.material?.brand || '' }}</td>
              <td>{{ it.material?.specification || '' }}</td>
              <td class="c">{{ it.material?.unit || '' }}</td>
              <td v-if="hasBatch">{{ it.batchNo || '-' }}</td>
              <td class="r" :class="Number(signedQty(it)) >= 0 ? 'in' : 'out'">{{ signedQty(it) }}</td>
              <td>{{ it.remark || '' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="c" :colspan="6 + (hasMultipleTypes ? 1 : 0) + (hasBatch ? 1 : 0)">合计</td>
              <td class="r total-qty">{{ totalText }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div class="remark-block">
          <div class="remark-title">备注：</div>
          <div class="remark-text">{{ doc.remark }}</div>
        </div>

        <div class="sign-row">
          <span>仓管员：{{ doc.keeper || '____________' }}</span>
          <span>审核人：{{ doc.approver || '____________' }}</span>
          <span>签收人：____________</span>
        </div>
      </div>

      <el-empty v-else-if="!loading" description="未找到该单号的库存事务记录" />
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: none;
  margin: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fff;
  border: 1px solid #d9dfe8;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(20, 40, 80, 0.06);
}
.sheet-wrap {
  max-width: 1000px;
  margin: 0 auto;
  min-height: 120px;
}
.sheet {
  position: relative;
  background: #fff;
  color: #000;
  padding: 28px 36px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 13px;
  line-height: 1.7;
}
.page-no {
  position: absolute;
  top: 18px;
  right: 36px;
  font-size: 12px;
}
.company {
  text-align: center;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 1px;
}
.doc-title {
  text-align: center;
  font-size: 23px;
  font-weight: 700;
  letter-spacing: 4px;
  margin: 4px 0 18px;
}
.meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 18px;
  row-gap: 2px;
  margin-bottom: 10px;
}
.meta-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta-item b {
  display: inline-block;
  width: 4.5em;
  font-weight: 700;
}
.items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.items th,
.items td {
  border: 1px solid #000;
  padding: 5px 6px;
  font-size: 12.5px;
  vertical-align: middle;
  word-break: break-all;
}
.items th {
  font-weight: 700;
  text-align: center;
  background: #f2f2f2;
}
.items tfoot td {
  font-weight: 700;
}
.c {
  text-align: center;
}
.r {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.in {
  color: #1a7f37;
}
.out {
  color: #c62828;
}
.total-qty {
  font-weight: 700;
}
.remark-block {
  margin-top: 14px;
  min-height: 58px;
}
.remark-title {
  font-weight: 700;
}
.remark-text {
  padding-left: 46px;
  white-space: pre-wrap;
}
.sign-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 26px;
  padding: 0 6px;
}
@media print {
  .no-print {
    display: none !important;
  }
  .print-view {
    max-width: none;
    margin: 0;
  }
  .sheet-wrap {
    max-width: none;
    margin: 0;
  }
  .sheet {
    border: none;
    box-shadow: none;
    padding: 8mm 10mm;
  }
  .items thead {
    display: table-header-group;
  }
  .items tr {
    break-inside: avoid;
  }
  .items th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
