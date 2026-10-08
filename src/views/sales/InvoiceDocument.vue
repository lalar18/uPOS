<script setup lang="ts">
// An invoice or quotation as a document: on screen inside a card, and (teleported into a
// .print-root, see utils/print.ts) on A4 paper. On phones the item table drops the
// # and price columns and shows "qty × price" under each item instead.
import { computed } from 'vue'
import { formatQuantity } from '@/api/products'
import type { Badge, DocumentCustomer, Totals } from '@/api/sales'
import type { Store } from '@/api/store'
import { formatMoney, formatPercentBp } from '@/utils/money'
import type { DocumentItem } from './lines'

const props = defineProps<{
  title: string // "Invoice" or "Quotation"
  reference: string
  store: Store | null
  customer: DocumentCustomer
  dates: { label: string; value: string }[]
  status?: Badge
  items: DocumentItem[]
  totals: Totals
  summary?: { label: string; cents: number; strong?: boolean }[] // returned, paid, balance due
  note: string | null
}>()

const storeLines = computed(() => {
  const s = props.store
  if (!s) return []
  const place = [s.address, s.city, s.province, s.postalCode].filter(Boolean).join(', ')
  return [place, [s.phone, s.email].filter(Boolean).join(' · '), s.tin ? `TIN: ${s.tin}` : ''].filter(Boolean)
})
</script>

<template>
  <div class="document">
    <div class="doc-head">
      <div class="min-w-0">
        <div class="doc-store">{{ store?.name ?? '' }}</div>
        <div v-for="line in storeLines" :key="line" class="doc-muted">{{ line }}</div>
      </div>
      <div class="doc-title-block">
        <div class="doc-title">{{ title }}</div>
        <div class="doc-reference">{{ reference }}</div>
        <span v-if="status" class="badge doc-badge" :class="status.className">{{ status.label }}</span>
      </div>
    </div>

    <div class="doc-parties">
      <div class="min-w-0">
        <div class="doc-label">{{ title === 'Quotation' ? 'Prepared for' : 'Bill to' }}</div>
        <div class="fw-semibold text-gray-9 text-break">{{ customer.name }}</div>
        <div v-if="customer.phone" class="doc-muted">{{ customer.phone }}</div>
        <div v-if="customer.address" class="doc-muted text-break">{{ customer.address }}</div>
      </div>
      <dl class="doc-dates">
        <template v-for="date in dates" :key="date.label">
          <dt>{{ date.label }}</dt>
          <dd>{{ date.value }}</dd>
        </template>
      </dl>
    </div>

    <table class="doc-items">
      <thead>
        <tr>
          <th class="col-index">#</th>
          <th>Item</th>
          <th class="text-end">Qty</th>
          <th class="text-end col-price">Price</th>
          <th class="text-end">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in items" :key="item.key">
          <td class="col-index">{{ index + 1 }}</td>
          <td>
            <div class="text-gray-9 text-break">{{ item.name }}</div>
            <div class="doc-muted">
              {{ item.sku }}<span class="price-inline"> · {{ formatMoney(item.priceCents) }} each</span>
            </div>
            <div v-if="item.returnedQuantity" class="doc-returned">
              {{ formatQuantity(item.returnedQuantity) }} {{ item.unitShortName }} returned
            </div>
          </td>
          <td class="text-end text-nowrap">{{ formatQuantity(item.quantity) }} {{ item.unitShortName }}</td>
          <td class="text-end text-nowrap col-price">{{ formatMoney(item.priceCents) }}</td>
          <td class="text-end text-nowrap">{{ formatMoney(item.totalCents) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="doc-foot">
      <div class="doc-note">
        <template v-if="note">
          <div class="doc-label">Note</div>
          <div class="text-break note-text">{{ note }}</div>
        </template>
      </div>
      <dl class="doc-totals">
        <dt>Subtotal</dt>
        <dd>{{ formatMoney(totals.subtotalCents) }}</dd>
        <template v-if="totals.discountCents > 0">
          <dt>Discount</dt>
          <dd>−{{ formatMoney(totals.discountCents) }}</dd>
        </template>
        <template v-if="totals.taxRateBp > 0">
          <dt>Tax ({{ formatPercentBp(totals.taxRateBp) }})</dt>
          <dd>{{ formatMoney(totals.taxCents) }}</dd>
        </template>
        <dt class="grand">Total</dt>
        <dd class="grand">{{ formatMoney(totals.totalCents) }}</dd>
        <template v-for="row in summary ?? []" :key="row.label">
          <dt :class="{ strong: row.strong }">{{ row.label }}</dt>
          <dd :class="{ strong: row.strong }">{{ formatMoney(row.cents) }}</dd>
        </template>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.document {
  color: #212b36;
  font-size: 14px;
}

.doc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 2px solid #212b36;
}

.doc-store {
  font-size: 18px;
  font-weight: 700;
}

.doc-muted {
  color: #646b72;
  font-size: 12px;
}

.doc-title-block {
  flex-shrink: 0;
  text-align: right;
}

.doc-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.doc-reference {
  font-weight: 600;
}

.doc-badge {
  margin-top: 4px;
  font-weight: 500;
}

.doc-parties {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
}

.doc-label {
  margin-bottom: 2px;
  color: #646b72;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.doc-dates {
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 12px;
  margin: 0;
  flex-shrink: 0;
  font-size: 13px;
}

.doc-dates dt {
  color: #646b72;
  font-weight: 400;
}

.doc-dates dd {
  margin: 0;
  text-align: right;
  font-weight: 500;
}

.doc-items {
  width: 100%;
  border-collapse: collapse;
}

.doc-items th {
  padding: 8px;
  background: #f3f6f9;
  font-size: 12px;
  font-weight: 600;
}

.doc-items td {
  padding: 8px;
  border-bottom: 1px solid #e6eaed;
  vertical-align: top;
}

.col-index {
  width: 32px;
  color: #646b72;
}

.price-inline {
  display: none;
}

.doc-returned {
  color: #e69500;
  font-size: 12px;
}

.doc-foot {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-top: 16px;
}

.doc-note {
  flex: 1;
  min-width: 0;
}

.note-text {
  white-space: pre-line;
}

.doc-totals {
  display: grid;
  grid-template-columns: auto auto;
  gap: 4px 24px;
  margin: 0;
  min-width: 240px;
}

.doc-totals dt {
  font-weight: 400;
  color: #646b72;
}

.doc-totals dd {
  margin: 0;
  text-align: right;
}

.doc-totals .grand {
  padding-top: 6px;
  border-top: 1px solid #212b36;
  color: #212b36;
  font-size: 16px;
  font-weight: 700;
}

.doc-totals .strong {
  color: #212b36;
  font-weight: 700;
}

.min-w-0 {
  min-width: 0;
}

/* Phones: stack the header blocks and simplify the table (never applies when printing) */
@media screen and (max-width: 575.98px) {
  .doc-head,
  .doc-parties,
  .doc-foot {
    flex-direction: column;
  }

  .doc-title-block {
    text-align: left;
  }

  .doc-dates dd {
    text-align: left;
  }

  .col-index,
  .col-price {
    display: none;
  }

  .price-inline {
    display: inline;
  }

  .doc-items th,
  .doc-items td {
    padding: 8px 4px;
  }

  .doc-totals {
    min-width: 0;
  }
}

@media print {
  .document {
    font-size: 11pt;
  }

  .doc-items th,
  .doc-badge {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .doc-items tr {
    break-inside: avoid;
  }
}
</style>
