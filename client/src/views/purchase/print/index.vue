<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { purchaseApi } from '../../../api'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)

// —— 需方信息（可改成实际公司名/联系方式）——
const COMPANY_NAME = '肇庆市博士芯电子科技有限公司'
const COMPANY_CONTACT = '采购部 | 电话：000-0000-0000 | 地址：肇庆市端州区睦岗街道太和南路创新创业园'

const statusLabel = (v: string) =>
  ({ draft: '草稿', confirmed: '已确认', partial_received: '部分收货', received: '已收货', cancelled: '已取消' })[v] || v

function fmt(d: string | null | undefined) {
  return d ? String(d).slice(0, 10) : '-'
}

function money(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return `¥${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function taxAmount(row: any) {
  const qty = Number(row.quantity || 0)
  const price = Number(row.unitPrice || 0)
  const rate = Number(row.taxRate || 0) / 100
  return row.taxIncluded ? price * qty : price * qty * (1 + rate)
}

const netTotal = computed(() => order.value?.totalAmount || 0)
const grossTotal = computed(() => (order.value?.items || []).reduce((s: number, i: any) => s + taxAmount(i), 0))
const taxTotal = computed(() => grossTotal.value - netTotal.value)

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

// ===== 人民币大写金额 =====
const CN_NUM = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const CN_UNIT = ['', '拾', '佰', '仟']
const CN_SECT = ['', '万', '亿', '兆']

function intToUpper(num: number): string {
  if (num === 0) return '零'
  const groups: number[] = []
  let n = num
  while (n > 0) {
    groups.push(n % 10000)
    n = Math.floor(n / 10000)
  }
  let out = ''
  groups.forEach((g, i) => {
    let s = ''
    const digits = [Math.floor(g / 1000), Math.floor(g / 100) % 10, Math.floor(g / 10) % 10, g % 10]
    let pendingZero = false
    let started = false
    for (let j = 0; j < 4; j++) {
      const d = digits[j]
      if (d === 0) {
        if (started) pendingZero = true
      } else {
        if (pendingZero) s += '零'
        s += CN_NUM[d] + CN_UNIT[3 - j]
        started = true
        pendingZero = false
      }
    }
    if (s.length > 0) {
      out = s + CN_SECT[i] + out
    }
  })
  return out
}

function moneyUpper(n: number): string {
  const fen = Math.round(n * 100)
  const intPart = Math.floor(fen / 100)
  const jiao = Math.floor((fen % 100) / 10)
  const fenPart = fen % 10
  let out = intToUpper(intPart) + '元'
  if (jiao === 0 && fenPart === 0) return out + '整'
  if (jiao === 0) out += '零'
  if (jiao > 0) out += CN_NUM[jiao] + '角'
  if (fenPart > 0) out += CN_NUM[fenPart] + '分'
  return out
}

const upperTotal = computed(() => (grossTotal.value > 0 ? moneyUpper(grossTotal.value) : '零元整'))

function doPrint() {
  window.print()
}

onMounted(async () => {
  const id = Number(route.query.id)
  if (!id) return
  const res: any = await purchaseApi.get(id)
  order.value = res.data
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-if="order" id="print-area" class="po-sheet">
      <!-- 单据头 -->
      <div class="po-header">
        <div class="po-brand">
          <div class="po-brand-name">{{ COMPANY_NAME }}</div>
          <div class="po-brand-sub">{{ COMPANY_CONTACT }}</div>
        </div>
        <div class="po-docno">
          <div class="po-docno-row"><span>单据编号</span><b>{{ order.orderNo }}</b></div>
          <div class="po-docno-row"><span>订货日期</span><b>{{ fmt(order.orderDate) }}</b></div>
          <div class="po-docno-row"><span>截止日期</span><b>{{ fmt(order.expectedDate) }}</b></div>
          <div class="po-docno-row"><span>单据状态</span><b>{{ statusLabel(order.status) }}</b></div>
        </div>
      </div>

      <div class="po-title">采购订单</div>
      <div class="po-title-rule"></div>

      <!-- 供需双方 -->
      <div class="po-parties">
        <div class="po-party">
          <h4>供方 <span class="po-mute">SUPPLIER</span></h4>
          <dl>
            <div><dt>名称</dt><dd>{{ order.supplier?.name || '未指定' }}</dd></div>
            <div><dt>联系人</dt><dd>{{ order.supplier?.contactPerson || '-' }}</dd></div>
            <div><dt>电话</dt><dd>{{ order.supplier?.phone || '-' }}</dd></div>
            <div><dt>供应商编号</dt><dd>{{ order.supplier?.code || '-' }}</dd></div>
          </dl>
        </div>
        <div class="po-party">
          <h4>需方 <span class="po-mute">BUYER</span></h4>
          <dl>
            <div><dt>名称</dt><dd>{{ COMPANY_NAME }}</dd></div>
            <div><dt>采购员</dt><dd>{{ order.buyer || '-' }}</dd></div>
            <div><dt>结算方式</dt><dd>{{ order.settleMethod || '-' }}</dd></div>
            <div><dt>电话</dt><dd>{{ COMPANY_CONTACT.split('|')[1]?.replace('电话：', '').trim() || '-' }}</dd></div>
          </dl>
        </div>
      </div>

      <!-- 明细 -->
      <table class="po-items">
        <thead>
          <tr>
            <th class="c" style="width: 34px">序</th>
            <th style="width: 84px">物料编码</th>
            <th>物料名称 / 规格型号</th>
            <th class="c" style="width: 44px">单位</th>
            <th class="r" style="width: 54px">数量</th>
            <th class="r" style="width: 72px">单价</th>
            <th class="c" style="width: 60px">税率</th>
            <th class="r" style="width: 86px">金额</th>
            <th class="c" style="width: 60px">库位</th>
            <th class="c" style="width: 80px">截止日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in order.items" :key="it.id">
            <td class="c">{{ Number(idx) + 1 }}</td>
            <td>{{ it.material?.code }}</td>
            <td class="l">
              {{ it.material?.name }}
              <span v-if="it.material?.specification" class="po-spec">{{ it.material.specification }}</span>
            </td>
            <td class="c">{{ it.unit || it.material?.unit }}</td>
            <td class="r">{{ it.quantity }}</td>
            <td class="r">{{ money(it.unitPrice) }}</td>
            <td class="c">{{ (it.taxIncluded ? '含税 ' : '') + (Number(it.taxRate || 0)) + '%' }}</td>
            <td class="r po-money">{{ money(taxAmount(it)) }}</td>
            <td class="c">{{ it.location || '-' }}</td>
            <td class="c">{{ fmt(it.expectedDate) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 合计 -->
      <div class="po-total">
        <div class="po-total-upper">
          <span class="po-upper-label">金额合计（大写）</span>
          <span class="po-upper">{{ upperTotal }}</span>
        </div>
        <div class="po-total-nums">
          <span>未税合计 <b>{{ money(netTotal) }}</b></span>
          <span>税额 <b>{{ money(taxTotal) }}</b></span>
          <span class="po-gross">含税合计 <b>{{ money(grossTotal) }}</b></span>
        </div>
      </div>

      <!-- 备注 + 签章 -->
      <div class="po-remark">
        <div class="po-remark-title">备注</div>
        <p>{{ order.remark || '无' }}</p>
      </div>

      <div class="po-sign">
        <div class="po-sign-cell">
          <div class="po-sign-name">供方（盖章）</div>
          <div class="po-sign-line">经办人：____________　日期：____________</div>
        </div>
        <div class="po-sign-cell">
          <div class="po-sign-name">需方（盖章）</div>
          <div class="po-sign-line">经办人：____________　日期：____________</div>
        </div>
      </div>

      <div class="po-foot">本单为双方确认的商业凭证，如有异议请于三个工作日内提出 · 打印日期 {{ todayStr }}</div>
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

/* ===== 单据纸张 ===== */
.po-sheet {
  background: #fff;
  color: #26303d;
  padding: 36px 42px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-size: 13px;
  line-height: 1.6;
}

/* 单据头：公司 + 编号 */
.po-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.po-brand-name {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 19px;
  font-weight: 700;
  color: #000;
  letter-spacing: 1px;
}
.po-brand-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #8a97a8;
}
.po-docno {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.po-docno-row span {
  display: inline-block;
  min-width: 56px;
  color: #8a97a8;
}
.po-docno-row b {
  font-weight: 600;
  color: #000;
  letter-spacing: 0.5px;
}

/* 标题 */
.po-title {
  text-align: center;
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 30px;
  font-weight: 700;
  color: #000;
  letter-spacing: 12px;
  margin-top: 22px;
  text-indent: 12px;
}
.po-title-rule {
  height: 2px;
  margin: 8px 0 22px;
  background: #000;
}

/* 供需双方 */
.po-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 20px;
}
.po-party {
  border: 1px solid #c9d4e0;
  border-top: 3px solid #000;
  border-radius: 4px;
  padding: 10px 14px 12px;
  background: #fff;
}
.po-party h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #000;
  letter-spacing: 1px;
}
.po-mute {
  font-size: 10px;
  color: #9aa7b6;
  letter-spacing: 2px;
  font-weight: 400;
  margin-left: 6px;
}
.po-party dl {
  margin: 0;
}
.po-party dl > div {
  display: flex;
  padding: 2px 0;
}
.po-party dt {
  width: 66px;
  color: #7d8a9a;
  flex: none;
}
.po-party dd {
  margin: 0;
  font-weight: 600;
}

/* 明细表 */
.po-items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.po-items th {
  background: #e8e8e8;
  color: #000;
  font-weight: 700;
  font-size: 12px;
  padding: 7px 6px;
  letter-spacing: 0.5px;
}
.po-items td {
  border: 1px solid #d5dde8;
  padding: 6px 6px;
  font-size: 12.5px;
  vertical-align: middle;
}
.po-items tbody tr:nth-child(even) {
  background: #f6f8fb;
}
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.l { text-align: left; }
.po-spec {
  display: block;
  color: #7d8a9a;
  font-size: 11px;
}
.po-money {
  font-weight: 700;
  color: #000;
}

/* 合计 */
.po-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid #c9d4e0;
  border-left: 4px solid #000;
  background: #fafafa;
}
.po-upper-label {
  font-size: 12px;
  color: #7d8a9a;
  margin-right: 10px;
}
.po-upper {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 15px;
  font-weight: 700;
  color: #000;
  letter-spacing: 1px;
}
.po-total-nums {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.po-total-nums span {
  margin-left: 16px;
}
.po-total-nums b {
  font-size: 14px;
  color: #26303d;
}
.po-gross b {
  color: #000;
  font-size: 16px;
}

/* 备注 */
.po-remark {
  margin-top: 18px;
  padding: 10px 14px;
  border: 1px dashed #c9d4e0;
  border-radius: 4px;
}
.po-remark-title {
  font-size: 12px;
  color: #7d8a9a;
  margin-bottom: 2px;
}
.po-remark p {
  margin: 0;
}

/* 签章 */
.po-sign {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 26px;
}
.po-sign-cell {
  padding-top: 18px;
  border-top: 1px solid #c9d4e0;
}
.po-sign-name {
  font-size: 13px;
  font-weight: 700;
  color: #000;
  margin-bottom: 14px;
}
.po-sign-line {
  font-size: 12px;
  color: #5a6874;
  letter-spacing: 1px;
}

.po-foot {
  margin-top: 20px;
  text-align: center;
  font-size: 10.5px;
  color: #9aa7b6;
  letter-spacing: 0.5px;
}

/* ===== 打印 ===== */
@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .po-sheet {
    border: none;
    box-shadow: none;
    padding: 12mm;
  }
  .po-parties,
  .po-total,
  .po-remark,
  .po-sign {
    break-inside: avoid;
  }
  .po-items thead {
    display: table-header-group;
  }
  .po-items th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .po-items tbody tr:nth-child(even) { background: #f6f8fb; }
  .po-title-rule, .po-party, .po-total, .po-remark {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
