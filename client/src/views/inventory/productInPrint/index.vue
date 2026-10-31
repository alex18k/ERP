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

const doc = computed(() => {
  const first = records.value[0] || {}
  const uniq = (vals: (string | undefined | null)[]) => [...new Set(vals.filter(Boolean) as string[])]
  return {
    effectiveDate: first.effectiveDate || first.createdAt,
    category: first.transactionType?.description || '产品入库',
    typeDesc: first.transactionType?.description || '-',
    warehouses: uniq(records.value.map((r) => r.warehouse?.name)).join('、') || '-',
    handler: uniq(records.value.map((r) => r.handler)).join('、'),
    departments: uniq(records.value.map((r) => r.department?.name)).join('、') || '-',
    keeper: uniq(records.value.map((r) => r.keeper)).join('、'),
    approver: uniq(records.value.map((r) => r.approver)).join('、'),
    remark: records.value.find((r) => r.mainRemark)?.mainRemark || '',
  }
})

const cnDate = computed(() => {
  const v = doc.value.effectiveDate
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

function formatQty(v: unknown) {
  const n = Number(v) || 0
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const totalQty = computed(() => records.value.reduce((s, r) => s + Number(r.quantity || 0), 0))

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
      <el-button @click="router.push('/inventory/product-in-maintain')"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" :disabled="records.length === 0" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="sheet-wrap">
      <div v-if="records.length > 0" id="print-area" class="sheet">
        <div class="page-no">第1页共1页</div>
        <div class="company">{{ companyName }}</div>
        <div class="doc-title">产品入库单</div>

        <div class="meta">
          <div class="meta-item"><b>单据日期</b>：{{ cnDate }}</div>
          <div class="meta-item"><b>单据编号</b>：{{ documentNo }}</div>
          <div class="meta-item"><b>入库类别</b>：{{ doc.category }}</div>
          <div class="meta-item"></div>
          <div class="meta-item"><b>业务类型</b>：{{ doc.typeDesc }}</div>
          <div class="meta-item"><b>仓库</b>：{{ doc.warehouses }}</div>
          <div class="meta-item"><b>车间</b>：{{ doc.departments }}</div>
          <div class="meta-item"><b>入库人</b>：{{ doc.handler || '____________' }}</div>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th style="width: 44px">序号</th>
              <th style="width: 88px">产品编码</th>
              <th style="width: 110px">产品名称</th>
              <th style="width: 72px">品牌</th>
              <th>规格型号</th>
              <th style="width: 50px">单位</th>
              <th style="width: 72px">数量</th>
              <th style="width: 84px">批号</th>
              <th style="width: 96px">生产订单</th>
              <th style="width: 62px">货位</th>
              <th style="width: 90px">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, idx) in records" :key="it.id">
              <td class="c">{{ it.lineNo ?? idx + 1 }}</td>
              <td>{{ it.material?.code }}</td>
              <td>{{ it.material?.name }}</td>
              <td>{{ it.material?.brand || '' }}</td>
              <td>{{ it.material?.specification || '' }}</td>
              <td class="c">{{ it.material?.unit || '' }}</td>
              <td class="r">{{ formatQty(it.quantity) }}</td>
              <td>{{ it.batchNo || '' }}</td>
              <td>{{ it.orderNo || '' }}</td>
              <td>{{ it.bin?.name || '' }}</td>
              <td>{{ it.remark || '' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="c" colspan="9">合计</td>
              <td class="r total-qty">{{ formatQty(totalQty) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

          <div class="remark-block">
            <span class="remark-title">备注：</span>
            <span class="remark-text">{{ doc.remark }}</span>
          </div>

        <div class="sign-row">
          <span>仓管员：{{ doc.keeper || '____________' }}</span>
          <span>审核人：{{ doc.approver || '____________' }}</span>
          <span>签收人：____________</span>
        </div>
      </div>

      <el-empty v-else-if="!loading" description="未找到该单号的产品入库记录" />
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
.total-qty {
  font-weight: 700;
}
.remark-block {
  margin-top: 14px;
  min-height: 58px;
  padding-left: 46px;
  text-indent: -46px;
}
.remark-title {
  font-weight: 700;
}
.remark-text {
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
