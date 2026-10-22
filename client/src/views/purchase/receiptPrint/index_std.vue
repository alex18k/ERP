<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { purchaseApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)
const receipts = ref<any[]>([])

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))
const companyContact = computed(() => {
  const c = companyInfo.value
  return [c.contact, c.phone ? `电话：${c.phone}` : '', c.address ? `地址：${c.address}` : ''].filter(Boolean).join(' | ')
})

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

function fmt(d: string | null | undefined) {
  return d ? String(d).slice(0, 10) : '-'
}

const totalQty = computed(() =>
  receipts.value.reduce((s, r) => s + Number(r.quantity || 0), 0).toLocaleString()
)

const receiptDates = computed(() => {
  const ds = receipts.value
    .map((r) => fmt(r.effectiveDate || r.createdAt))
    .filter((x) => x !== '-')
    .sort()
  if (ds.length === 0) return '-'
  return ds[0] === ds[ds.length - 1] ? ds[0] : `${ds[0]} ~ ${ds[ds.length - 1]}`
})

function doPrint() {
  window.print()
}

async function loadByOrderId(id: number) {
  const res: any = await purchaseApi.get(id)
  order.value = res.data
  if (order.value?.orderNo) {
    const r: any = await purchaseApi.receipts({ orderNo: order.value.orderNo, pageSize: 1000 })
    receipts.value = r.data.items || []
  }
}

onMounted(async () => {
  loadCompanyInfo()
  const receiptNo = String(route.query.receiptNo || '').trim()
  if (receiptNo) {
    const r: any = await purchaseApi.receipts({ receiptNo, pageSize: 1000 })
    receipts.value = (r.data.items || []).filter((it: any) => (it.receiptNo || it.documentNo) === receiptNo)
    const orderId = Number(receipts.value[0]?.relatedId)
    if (orderId) {
      const res: any = await purchaseApi.get(orderId)
      order.value = res.data
    }
    return
  }
  const id = Number(route.query.id)
  if (id) await loadByOrderId(id)
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-if="order" id="print-area" class="sheet">
      <table class="items">
        <thead>
          <tr class="doc-head-row">
            <td colspan="8" class="doc-head-cell">
              <div class="doc-header">
                <div class="brand">
                  <div class="brand-name">{{ companyName }}</div>
                  <div class="brand-sub">{{ companyContact }}</div>
                </div>
                <div class="docno">
                  <div class="docno-row"><span>收货单号</span><b>{{ receipts[0]?.receiptNo || receipts[0]?.documentNo || '-' }}</b></div>
                  <div class="docno-row"><span>采购单号</span><b>{{ order.orderNo }}</b></div>
                  <div class="docno-row"><span>订货日期</span><b>{{ fmt(order.orderDate) }}</b></div>
                  <div class="docno-row"><span>收货日期</span><b>{{ receiptDates }}</b></div>
                </div>
              </div>

              <div class="title">收货单</div>
              <div class="title-rule"></div>

              <div class="parties">
                <div class="party">
                  <h4>供方 <span class="mute">SUPPLIER</span></h4>
                  <dl>
                    <div><dt>名称</dt><dd>{{ order.supplier?.name || '未指定' }}</dd></div>
                    <div><dt>联系人</dt><dd>{{ order.supplier?.contactPerson || '-' }}</dd></div>
                    <div><dt>电话</dt><dd>{{ order.supplier?.phone || '-' }}</dd></div>
                    <div><dt>供应商编号</dt><dd>{{ order.supplier?.code || '-' }}</dd></div>
                  </dl>
                </div>
                <div class="party">
                  <h4>收货信息 <span class="mute">RECEIVE</span></h4>
                  <dl>
                    <div><dt>需方</dt><dd>{{ companyName }}</dd></div>
                    <div><dt>采购员</dt><dd>{{ order.buyer || '-' }}</dd></div>
                    <div><dt>收货仓库</dt><dd>{{ receipts[0]?.warehouse?.name || '-' }}</dd></div>
                    <div><dt>收货人</dt><dd>{{ receipts[0]?.operator?.realName || receipts[0]?.operator?.username || '-' }}</dd></div>
                  </dl>
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <th class="c" style="width: 34px">序</th>
            <th style="width: 90px">物料编码</th>
            <th>物料名称 / 规格型号</th>
            <th class="c" style="width: 46px">单位</th>
            <th class="r" style="width: 64px">收货数量</th>
            <th style="width: 120px">批号</th>
            <th style="width: 110px">仓库 / 货位</th>
            <th class="c" style="width: 88px">收货日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in receipts" :key="it.id">
            <td class="c">{{ Number(idx) + 1 }}</td>
            <td>{{ it.material?.code }}</td>
            <td class="l">
              {{ it.material?.name }}
              <span v-if="it.material?.specification" class="spec">{{ it.material.specification }}</span>
            </td>
            <td class="c">{{ it.material?.unit || '-' }}</td>
            <td class="r qty">{{ it.quantity }}</td>
            <td>{{ it.batchNo || '-' }}</td>
            <td>{{ (it.warehouse?.name || '-') + (it.bin?.name ? ' / ' + it.bin.name : '') }}</td>
            <td class="c">{{ fmt(it.effectiveDate || it.createdAt) }}</td>
          </tr>
          <tr v-if="receipts.length === 0">
            <td class="c empty" colspan="8">暂无收货明细</td>
          </tr>
        </tbody>
      </table>

      <div class="total">
        <span class="total-label">合计收货数量</span>
        <span class="total-qty">{{ totalQty }}</span>
      </div>

      <div class="remark">
        <div class="remark-title">备注</div>
        <p>{{ order.remark || '无' }}</p>
      </div>

      <div class="sign">
        <div class="sign-cell">
          <div class="sign-name">收货人</div>
          <div class="sign-line">签字：____________　日期：____________</div>
        </div>
        <div class="sign-cell">
          <div class="sign-name">仓管员</div>
          <div class="sign-line">签字：____________　日期：____________</div>
        </div>
        <div class="sign-cell">
          <div class="sign-name">供应商（签收）</div>
          <div class="sign-line">签字：____________　日期：____________</div>
        </div>
      </div>

      <div class="foot">本单为物料收货凭证，请核对无误后签字确认 · 打印日期 {{ todayStr }}</div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: 960px;
  margin: 0 auto;
}
.toolbar {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #d9dfe8;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(20, 40, 80, 0.06);
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

.parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 20px;
}
.party {
  border: 1px solid #c9d4e0;
  border-top: 3px solid #000;
  border-radius: 4px;
  padding: 10px 14px 12px;
  background: #fff;
}
.party h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #000;
  letter-spacing: 1px;
}
.mute {
  font-size: 10px;
  color: #9aa7b6;
  letter-spacing: 2px;
  font-weight: 400;
  margin-left: 6px;
}
.party dl {
  margin: 0;
}
.party dl > div {
  display: flex;
  padding: 2px 0;
}
.party dt {
  width: 66px;
  color: #7d8a9a;
  flex: none;
}
.party dd {
  margin: 0;
  font-weight: 600;
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
.qty {
  font-weight: 700;
  color: #000;
}
.empty {
  color: #9aa7b6;
  padding: 18px 0;
}

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
.remark p {
  margin: 0;
}

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
  .sheet {
    border: none;
    box-shadow: none;
    padding: 12mm;
  }
  .parties,
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
  .items tbody tr:nth-child(even) { background: #f6f8fb; }
  .title-rule, .party, .total, .remark {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
