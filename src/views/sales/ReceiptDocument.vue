<script setup lang="ts">
// A sale as a till receipt, sized for 58–80 mm thermal paper. Shown in the POS receipt
// dialog and printed through a .print-root (see utils/print.ts).
import { computed } from 'vue'
import { formatQuantity } from '@/api/products'
import { paymentMethodLabel, type Sale } from '@/api/sales'
import { formatDateTime } from '@/api/stock'
import type { Store } from '@/api/store'
import { DEFAULT_SETTINGS } from '@/api/settings'
import { formatMoney, formatPercentBp } from '@/utils/money'

const props = defineProps<{ sale: Sale; store: Store | null }>()

const storeLines = computed(() => {
  const s = props.store
  if (!s) return []
  const place = [s.address, s.city, s.province].filter(Boolean).join(', ')
  return [place, s.phone ?? '', s.tin ? `TIN: ${s.tin}` : ''].filter(Boolean)
})

// Set on General Settings; blank prints no message
const footer = computed(() => props.store?.receiptFooter ?? DEFAULT_SETTINGS.receiptFooter)

// Refunds show on the sale's page; a receipt lists the money taken
const payments = computed(() => props.sale.payments.filter((p) => p.amountCents > 0))
</script>

<template>
  <div class="receipt">
    <div class="center">
      <div class="store">{{ store?.name ?? '' }}</div>
      <div v-for="line in storeLines" :key="line" class="small">{{ line }}</div>
    </div>

    <div class="rule"></div>
    <div class="row-between"><span>{{ sale.reference }}</span><span>{{ formatDateTime(sale.createdAt) }}</span></div>
    <div class="small">Customer: {{ sale.customer.name }}</div>
    <div class="small">Cashier: {{ sale.userName }}</div>
    <div class="rule"></div>

    <div v-for="item in sale.items" :key="item.id" class="item">
      <div class="item-name">{{ item.name }}</div>
      <div class="row-between">
        <span>{{ formatQuantity(item.quantity) }} {{ item.unitShortName }} × {{ formatMoney(item.priceCents) }}</span>
        <span>{{ formatMoney(item.totalCents) }}</span>
      </div>
    </div>

    <div class="rule"></div>
    <div class="row-between"><span>Subtotal</span><span>{{ formatMoney(sale.subtotalCents) }}</span></div>
    <div v-if="sale.discountCents > 0" class="row-between">
      <span>Discount</span><span>−{{ formatMoney(sale.discountCents) }}</span>
    </div>
    <div v-if="sale.taxRateBp > 0" class="row-between">
      <span>Tax ({{ formatPercentBp(sale.taxRateBp) }})</span><span>{{ formatMoney(sale.taxCents) }}</span>
    </div>
    <div class="row-between total"><span>TOTAL</span><span>{{ formatMoney(sale.totalCents) }}</span></div>

    <template v-for="payment in payments" :key="payment.id">
      <div class="row-between">
        <span>{{ paymentMethodLabel(payment.method) }}</span>
        <span>{{ formatMoney(payment.tenderedCents ?? payment.amountCents) }}</span>
      </div>
      <div v-if="payment.changeCents" class="row-between">
        <span>Change</span><span>{{ formatMoney(payment.changeCents) }}</span>
      </div>
      <div v-if="payment.reference" class="small">Ref: {{ payment.reference }}</div>
    </template>
    <div v-if="sale.dueCents > 0" class="row-between strong">
      <span>Balance due</span><span>{{ formatMoney(sale.dueCents) }}</span>
    </div>

    <div class="rule"></div>
    <div v-if="footer" class="center small footer-message">{{ footer }}</div>
    <div class="center small">This serves as your sales receipt.</div>
  </div>
</template>

<style scoped>
.receipt {
  width: 100%;
  max-width: 72mm;
  margin: 0 auto;
  color: #000000;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.35;
}

.center {
  text-align: center;
}

.store {
  font-size: 15px;
  font-weight: 700;
}

.small {
  font-size: 11px;
  word-break: break-word;
}

.footer-message {
  white-space: pre-line; /* keeps the line breaks typed in settings */
}

.rule {
  margin: 6px 0;
  border-top: 1px dashed #000000;
}

.row-between {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.row-between > span:last-child {
  flex-shrink: 0;
  text-align: right;
}

.item {
  margin-bottom: 3px;
}

.item-name {
  word-break: break-word;
}

.total {
  margin: 4px 0;
  font-size: 14px;
  font-weight: 700;
}

.strong {
  font-weight: 700;
}
</style>
