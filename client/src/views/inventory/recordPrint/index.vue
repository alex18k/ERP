<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stockApi } from '../../../api'

const route = useRoute()
const router = useRouter()
const records = ref<any[]>([])
const loading = ref(false)

const COMPANY_NAME = '肇庆市博士芯电子科技有限公司'
const COMPANY_CONTACT = '仓储部 | 电话：000-0000-0000 | 地址：肇庆市端州区睦岗街道太和南路创新创业园'

const documentNo = computed(() => String(route.query.documentNo || '').trim())
const preferredTypeId = computed(() => Number(route.query.typeId) || null)

const title = computed(() => {
  const preferred = preferredTypeId.value
    ? records.value.find((r) => r.transactionTypeId === preferredTypeId.value)?.transactionType
    : null
  const type = preferred || records.value[0]?.transactionType
  return `${type?.description || '库存事务'}单`
})

const hasMultipleTypes = computed(() => new Set(records.value.map((r) => r.transactionTypeId ?? 0)).size > 1)

const doc = computed(() => {
  const first = records.value[0] || {}
  const warehouses = [...new Set(records.value.map((r) => r.warehouse?.name).filter(Boolean))]
  const operators = [...new Set(records.value.map((r) => r.operator?.realName || r.operator?.username).filter(Boolean))]
  const remark = records.value.find((r) => r.remark)?.remark || ''
  return {
    orderNo: records.value.find((r) => r.orderNo)?.orderNo || '',
    effectiveDate: first.effectiveDate || first.createdAt,
    warehouses: warehouses.join('、') || '-',
    operators: operators.join('、') || '-',
    remark,
  }
})

const inboundQty = computed(() => records.value.filter((r) => r.type === 'in').reduce((s, r) => s + Number(r.quantity || 0), 0))
const outboundQty = computed(() => records.value.filter((r) => r.type === 'out').reduce((s, r) => s + Number(r.quantity || 0), 0))

const totalText = computed(() => {
  const fmt = (n: number) => n.toLocaleString()
  if (inboundQty.value > 0 && outboundQty.value > 0) {
    return `入库合计 ${fmt(inboundQty.value)} / 出库合计 ${fmt(outboundQty.value)}`
  }
  if (outboundQty.value > 0) return `出库合计 ${fmt(outboundQty.value)}`
  return `入库合计 ${fmt(inboundQty.value)}`
})

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

function fmt(d: string | null | undefined) {
  return d ? String(d).slice(0, 10) : '-'
}

function signedQty(row: any) {
  if (row.type === 'out') return `-${row.quantity}`
  return `+${row.quantity}`
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

onMounted(loadData)
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
        <table class="items">
          <thead>
            <tr class="doc-head-row">
              <td :colspan="hasMultipleTypes ? 9 : 8" class="doc-head-cell">
                <div class="doc-header">
                  <div class="brand">
                    <div class="brand-name">{{ COMPANY_NAME }}</div>
                    <div class="brand-sub">{{ COMPANY_CONTACT }}</div>
                  </div>
                  <div class="docno">
                    <div class="docno-row"><span>事务单号</span><b>{{ documentNo }}</b></div>
                    <div v-if="doc.orderNo" class="docno-row"><span>源单号</span><b>{{ doc.orderNo }}</b></div>
                    <div class="docno-row"><span>生效日期</span><b>{{ fmt(doc.effectiveDate) }}</b></div>
                    <div class="docno-row"><span>操作员</span><b>{{ doc.operators }}</b></div>
                    <div class="docno-row"><span>仓库</span><b>{{ doc.warehouses }}</b></div>
                    <div class="docno-row"><span>打印日期</span><b>{{ todayStr }}</b></div>
                  </div>
                </div>

                <div class="title">{{ title }}</div>
                <div class="title-rule"></div>
              </td>
            </tr>
            <tr>
              <th class="c" style="width: 36px">序</th>
              <th v-if="hasMultipleTypes" style="width: 96px">事务类型</th>
              <th style="width: 92px">物料编码</th>
              <th>物料名称 / 规格型号</th>
              <th class="c" style="width: 50px">单位</th>
              <th style="width: 118px">批号</th>
              <th style="width: 120px">仓库 / 货位</th>
              <th class="r" style="width: 76px">数量</th>
              <th style="width: 130px">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, idx) in records" :key="it.id">
              <td class="c">{{ it.lineNo ?? idx + 1 }}</td>
              <td v-if="hasMultipleTypes">{{ it.transactionType?.description || '-' }}</td>
              <td>{{ it.material?.code }}</td>
              <td class="l">
                {{ it.material?.name }}
                <span v-if="it.material?.specification" class="spec">{{ it.material.specification }}</span>
              </td>
              <td class="c">{{ it.material?.unit || '-' }}</td>
              <td>{{ it.batchNo || '-' }}</td>
              <td>{{ (it.warehouse?.name || '-') + (it.bin?.name ? ' / ' + it.bin.name : '') }}</td>
              <td class="r qty" :class="it.type === 'out' ? 'out' : 'in'">{{ signedQty(it) }}</td>
              <td>{{ it.remark || '-' }}</td>
            </tr>
          </tbody>
        </table>

        <div class="total">
          <span class="total-label">合计</span>
          <span class="total-qty">{{ totalText }}</span>
        </div>

        <div class="remark">
          <div class="remark-title">备注</div>
          <p>{{ doc.remark || '无' }}</p>
        </div>

        <div class="sign">
          <div class="sign-cell">
            <div class="sign-name">制单人</div>
            <div class="sign-line">签字：____________　日期：____________</div>
          </div>
          <div class="sign-cell">
            <div class="sign-name">仓管员</div>
            <div class="sign-line">签字：____________　日期：____________</div>
          </div>
          <div class="sign-cell">
            <div class="sign-name">审核</div>
            <div class="sign-line">签字：____________　日期：____________</div>
          </div>
        </div>

        <div class="foot">本单为库存事务凭证，请核对无误后签字确认 · 打印日期 {{ todayStr }}</div>
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
  max-width: 980px;
  margin: 0 auto;
  min-height: 120px;
}
.sheet {
  background: #fff;
  color: #26303d;
  padding: 36px 42px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-size: 13px;
  line-height: 1.6;
}
.doc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.brand-name {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 19px;
  font-weight: 700;
  color: #000;
  letter-spacing: 1px;
}
.brand-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #8a97a8;
}
.docno {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.docno-row span {
  display: inline-block;
  min-width: 56px;
  color: #8a97a8;
}
.docno-row b {
  font-weight: 600;
  color: #000;
  letter-spacing: 0.5px;
}
.title {
  text-align: center;
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 30px;
  font-weight: 700;
  color: #000;
  letter-spacing: 12px;
  margin-top: 22px;
  text-indent: 12px;
}
.title-rule {
  height: 2px;
  margin: 8px 0 22px;
  background: #000;
}
.items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.doc-head-cell {
  border: none !important;
  background: #fff !important;
  padding: 0 !important;
}
.items th {
  background: #e8e8e8;
  color: #000;
  font-weight: 700;
  font-size: 12px;
  padding: 7px 6px;
  letter-spacing: 0.5px;
}
.items td {
  border: 1px solid #d5dde8;
  padding: 6px 6px;
  font-size: 12.5px;
  vertical-align: middle;
  word-break: break-all;
}
.items tbody tr:nth-child(even) {
  background: #f6f8fb;
}
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.l { text-align: left; }
.spec {
  display: block;
  color: #7d8a9a;
  font-size: 11px;
}
.qty { font-weight: 700; color: #000; }
.in { color: #1a7f37; }
.out { color: #c62828; }
.total {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid #c9d4e0;
  border-right: 4px solid #000;
  background: #fafafa;
}
.total-label {
  font-size: 12px;
  color: #7d8a9a;
  margin-right: 12px;
}
.total-qty {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 17px;
  font-weight: 700;
  color: #000;
}
.remark {
  margin-top: 18px;
  padding: 10px 14px;
  border: 1px dashed #c9d4e0;
  border-radius: 4px;
}
.remark-title {
  font-size: 12px;
  color: #7d8a9a;
  margin-bottom: 2px;
}
.remark p { margin: 0; }
.sign {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin-top: 26px;
}
.sign-cell {
  padding-top: 18px;
  border-top: 1px solid #c9d4e0;
}
.sign-name {
  font-size: 13px;
  font-weight: 700;
  color: #000;
  margin-bottom: 14px;
}
.sign-line {
  font-size: 12px;
  color: #5a6874;
  letter-spacing: 1px;
}
.foot {
  margin-top: 20px;
  text-align: center;
  font-size: 10.5px;
  color: #9aa7b6;
  letter-spacing: 0.5px;
}
@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .sheet-wrap { max-width: none; margin: 0; }
  .sheet {
    border: none;
    box-shadow: none;
    padding: 12mm;
  }
  .total,
  .remark,
  .sign {
    break-inside: avoid;
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
