<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { orderApi } from '../../../api'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)

// —— 卖方信息（可改成实际公司名/联系方式）——
const SELLER_NAME = 'XX智造装备有限公司'
const SELLER_CONTACT = '业务部 | 电话：000-0000-0000 | 地址：XX省XX市XX区XX路1号'

const statusLabel = (v: string) =>
  ({ draft: '草稿', confirmed: '已确认', in_production: '生产中', completed: '已完工', shipped: '已发货', cancelled: '已取消' })[v] || v

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
  const res: any = await orderApi.get(id)
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

    <div v-if="order" id="print-area" class="so-sheet">
      <!-- 单据头 -->
      <div class="so-header">
        <div class="so-brand">
          <div class="so-brand-name">{{ SELLER_NAME }}</div>
          <div class="so-brand-sub">{{ SELLER_CONTACT }}</div>
        </div>
        <div class="so-docno">
          <div class="so-docno-row"><span>单据编号</span><b>{{ order.orderNo }}</b></div>
          <div class="so-docno-row"><span>制单日期</span><b>{{ fmt(order.orderDate) }}</b></div>
          <div class="so-docno-row"><span>单据状态</span><b>{{ statusLabel(order.status) }}</b></div>
        </div>
      </div>

      <div class="so-title">销售订单</div>
      <div class="so-title-rule"></div>

      <!-- 买卖双方 -->
      <div class="so-parties">
        <div class="so-party">
          <h4>买方 <span class="so-mute">BUYER</span></h4>
          <dl>
            <div><dt>名称</dt><dd>{{ order.customerName }}</dd></div>
            <div><dt>联系人</dt><dd>{{ order.contactPerson || '-' }}</dd></div>
            <div><dt>电话</dt><dd>{{ order.contactPhone || '-' }}</dd></div>
            <div><dt>客户编号</dt><dd>{{ order.customerCode || '-' }}</dd></div>
          </dl>
        </div>
        <div class="so-party">
          <h4>卖方 <span class="so-mute">SELLER</span></h4>
          <dl>
            <div><dt>名称</dt><dd>{{ SELLER_NAME }}</dd></div>
            <div><dt>经办销售</dt><dd>{{ order.seller1 || '-' }}{{ order.seller2 ? `、${order.seller2}` : '' }}</dd></div>
            <div><dt>结算方式</dt><dd>{{ order.paymentMethod || '-' }}</dd></div>
            <div><dt>渠道</dt><dd>{{ order.channel || '-' }}</dd></div>
          </dl>
        </div>
      </div>

      <!-- 明细 -->
      <table class="so-items">
        <thead>
          <tr>
            <th class="c" style="width: 34px">序</th>
            <th>物料编码</th>
            <th>物料名称 / 规格型号</th>
            <th class="c" style="width: 52px">单位</th>
            <th class="r" style="width: 60px">数量</th>
            <th class="r" style="width: 86px">未税单价</th>
            <th class="c" style="width: 70px">税率</th>
            <th class="r" style="width: 100px">含税金额</th>
            <th class="c" style="width: 92px">交货日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in order.items" :key="it.id">
            <td class="c">{{ Number(idx) + 1 }}</td>
            <td>{{ it.material?.code }}</td>
            <td class="l">
              {{ it.material?.name }}
              <span v-if="it.material?.specification" class="so-spec">{{ it.material.specification }}</span>
            </td>
            <td class="c">{{ it.unit || it.material?.unit }}</td>
            <td class="r">{{ it.quantity }}</td>
            <td class="r">{{ money(it.unitPrice) }}</td>
            <td class="c">{{ (it.taxIncluded ? '含税 ' : '') + (Number(it.taxRate || 0)) + '%' }}</td>
            <td class="r so-money">{{ money(taxAmount(it)) }}</td>
            <td class="c">{{ fmt(it.deliveryDate) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 合计 -->
      <div class="so-total">
        <div class="so-total-upper">
          <span class="so-upper-label">金额合计（大写）</span>
          <span class="so-upper">{{ upperTotal }}</span>
        </div>
        <div class="so-total-nums">
          <span>未税合计 <b>{{ money(netTotal) }}</b></span>
          <span>税额 <b>{{ money(taxTotal) }}</b></span>
          <span class="so-gross">含税合计 <b>{{ money(grossTotal) }}</b></span>
        </div>
      </div>

      <!-- 备注 + 签章 -->
      <div class="so-remark">
        <div class="so-remark-title">备注</div>
        <p>{{ order.remark || '无' }}</p>
      </div>

      <div class="so-sign">
        <div class="so-sign-cell">
          <div class="so-sign-name">买方（盖章）</div>
          <div class="so-sign-line">经办人：____________　日期：____________</div>
        </div>
        <div class="so-sign-cell">
          <div class="so-sign-name">卖方（盖章）</div>
          <div class="so-sign-line">经办人：____________　日期：____________</div>
        </div>
      </div>

      <div class="so-foot">本单为双方确认的商业凭证，如有异议请于三个工作日内提出 · 打印日期 {{ todayStr }}</div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: 870px;
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
.so-sheet {
  background: #fff;
  color: #26303d;
  padding: 36px 42px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-size: 13px;
  line-height: 1.6;
}

/* 单据头：公司 + 编号 */
.so-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.so-brand-name {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 19px;
  font-weight: 700;
  color: #000;
  letter-spacing: 1px;
}
.so-brand-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #8a97a8;
}
.so-docno {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.so-docno-row span {
  display: inline-block;
  min-width: 56px;
  color: #8a97a8;
}
.so-docno-row b {
  font-weight: 600;
  color: #000;
  letter-spacing: 0.5px;
}

/* 标题 */
.so-title {
  text-align: center;
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 30px;
  font-weight: 700;
  color: #000;
  letter-spacing: 12px;
  margin-top: 22px;
  text-indent: 12px;
}
.so-title-rule {
  height: 2px;
  margin: 8px 0 22px;
  background: #000;
}

/* 买卖双方 */
.so-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 20px;
}
.so-party {
  border: 1px solid #c9d4e0;
  border-top: 3px solid #000;
  border-radius: 4px;
  padding: 10px 14px 12px;
  background: #fff;
}
.so-party h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #000;
  letter-spacing: 1px;
}
.so-mute {
  font-size: 10px;
  color: #9aa7b6;
  letter-spacing: 2px;
  font-weight: 400;
  margin-left: 6px;
}
.so-party dl {
  margin: 0;
}
.so-party dl > div {
  display: flex;
  padding: 2px 0;
}
.so-party dt {
  width: 58px;
  color: #7d8a9a;
  flex: none;
}
.so-party dd {
  margin: 0;
  font-weight: 600;
}

/* 明细表 */
.so-items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.so-items th {
  background: #e8e8e8;
  color: #000;
  font-weight: 700;
  font-size: 12px;
  padding: 7px 6px;
  letter-spacing: 0.5px;
}
.so-items td {
  border: 1px solid #d5dde8;
  padding: 6px 6px;
  font-size: 12.5px;
  vertical-align: middle;
}
.so-items tbody tr:nth-child(even) {
  background: #f6f8fb;
}
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.l { text-align: left; }
.so-spec {
  display: block;
  color: #7d8a9a;
  font-size: 11px;
}
.so-money {
  font-weight: 700;
  color: #000;
}

/* 合计 */
.so-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid #c9d4e0;
  border-left: 4px solid #000;
  background: #fafafa;
}
.so-upper-label {
  font-size: 12px;
  color: #7d8a9a;
  margin-right: 10px;
}
.so-upper {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 15px;
  font-weight: 700;
  color: #000;
  letter-spacing: 1px;
}
.so-total-nums {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.so-total-nums span {
  margin-left: 16px;
}
.so-total-nums b {
  font-size: 14px;
  color: #26303d;
}
.so-gross b {
  color: #000;
  font-size: 16px;
}

/* 备注 */
.so-remark {
  margin-top: 18px;
  padding: 10px 14px;
  border: 1px dashed #c9d4e0;
  border-radius: 4px;
}
.so-remark-title {
  font-size: 12px;
  color: #7d8a9a;
  margin-bottom: 2px;
}
.so-remark p {
  margin: 0;
}

/* 签章 */
.so-sign {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 26px;
}
.so-sign-cell {
  padding-top: 18px;
  border-top: 1px solid #c9d4e0;
}
.so-sign-name {
  font-size: 13px;
  font-weight: 700;
  color: #000;
  margin-bottom: 14px;
}
.so-sign-line {
  font-size: 12px;
  color: #5a6874;
  letter-spacing: 1px;
}

.so-foot {
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
  .so-sheet {
    border: none;
    box-shadow: none;
    padding: 12mm;
  }
  .so-parties,
  .so-total,
  .so-remark,
  .so-sign {
    break-inside: avoid;
  }
  .so-items thead {
    display: table-header-group;
  }
  .so-items th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .so-items tbody tr:nth-child(even) { background: #f6f8fb; }
  .so-title-rule, .so-party, .so-total, .so-remark {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>