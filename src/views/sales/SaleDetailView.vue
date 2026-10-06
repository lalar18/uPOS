<script setup lang="ts">
// One sale (/sales/:id) or invoice (/invoices/:id): the invoice itself, its payments and
// returns, and actions to record a payment, return items or print it (A4 or receipt).
import { computed, nextTick, ref } from 'vue'
import { useRoute } from 'vue-router'
import { formatPeso } from '@/api/products'
import { getSale, invoiceBadge, paymentMethodLabel, type Sale } from '@/api/sales'
import { returnReasonLabel } from '@/api/salesReturns'
import { formatDateTime } from '@/api/stock'
import { getStore, type Store } from '@/api/store'
import { currentUser } from '@/auth'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { usePrintRoot } from '@/utils/print'
import InvoiceDocument from './InvoiceDocument.vue'
import PaymentFormModal from './PaymentFormModal.vue'
import ReceiptDocument from './ReceiptDocument.vue'

const props = defineProps<{ id: string }>()

const route = useRoute()
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const isInvoice = computed(() => route.name === 'invoice-detail')
const today = toIsoDate()

const sale = ref<Sale | null>(null)
const store = ref<Store | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    sale.value = await getSale(Number(props.id))
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the sale'
  } finally {
    loading.value = false
  }
}

load()
// The store's details head the invoice; it still shows without them
getStore()
  .then((result) => (store.value = result))
  .catch(() => {})

const badge = computed(() => (sale.value ? invoiceBadge(sale.value, today) : undefined))
const canReturn = computed(
  () => isAdmin.value && !!sale.value?.items.some((item) => item.quantity - item.returnedQuantity > 0),
)

const documentItems = computed(() =>
  (sale.value?.items ?? []).map((item) => ({ ...item, key: item.id })),
)

const dates = computed(() => {
  const s = sale.value
  if (!s) return []
  const list = [{ label: 'Date', value: formatIsoDate(s.saleDate) }]
  if (s.dueDate) list.push({ label: 'Due date', value: formatIsoDate(s.dueDate) })
  if (s.quotation) list.push({ label: 'Quotation', value: s.quotation.reference })
  return list
})

const summary = computed(() => {
  const s = sale.value
  if (!s) return []
  const rows: { label: string; cents: number; strong?: boolean }[] = []
  if (s.returnedCents > 0) rows.push({ label: 'Returned', cents: -s.returnedCents })
  rows.push({ label: 'Paid', cents: s.paidCents })
  rows.push({ label: 'Balance due', cents: Math.max(s.dueCents, 0), strong: true })
  return rows
})

// --- Printing ---

const printMode = ref<'invoice' | 'receipt'>('invoice')
usePrintRoot(() =>
  printMode.value === 'receipt' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 12mm; }',
)

async function print(mode: 'invoice' | 'receipt') {
  printMode.value = mode
  await nextTick() // let the print copy switch layout first
  window.print()
}

// --- Record payment ---

const paying = ref(false)

function onPaid(updated: Sale) {
  paying.value = false
  sale.value = updated
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ sale ? sale.reference : isInvoice ? 'Invoice' : 'Sale' }}</h4>
      <h6 v-if="sale">{{ sale.customer.name }} · {{ formatIsoDate(sale.saleDate) }}</h6>
    </div>
    <div class="page-actions d-flex flex-wrap align-items-center gap-2">
      <RouterLink :to="{ name: isInvoice ? 'invoices' : 'sales' }" class="btn btn-white border">
        <i class="ti ti-arrow-left me-1"></i>Back
      </RouterLink>
      <template v-if="sale">
        <button type="button" class="btn btn-white border" @click="print('receipt')">
          <i class="ti ti-receipt me-1"></i>Receipt
        </button>
        <button type="button" class="btn btn-white border" @click="print('invoice')">
          <i class="ti ti-printer me-1"></i>Print
        </button>
        <RouterLink
          v-if="canReturn"
          :to="{ name: 'sales-returns', query: { sale: sale.id } }"
          class="btn btn-white border"
        >
          <i class="ti ti-receipt-refund me-1"></i>Return Items
        </RouterLink>
        <button v-if="sale.dueCents > 0" type="button" class="btn btn-primary" @click="paying = true">
          <i class="ti ti-cash me-1"></i>Record Payment
        </button>
      </template>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-else-if="loading && !sale" class="card"><div class="card-body text-center text-gray-5 py-5">Loading…</div></div>

  <div v-if="sale" class="row g-3">
    <div class="col-xl-8">
      <div class="card mb-0">
        <div class="card-body">
          <InvoiceDocument
            title="Invoice"
            :reference="sale.reference"
            :store="store"
            :customer="sale.customer"
            :dates="dates"
            :status="badge"
            :items="documentItems"
            :totals="sale"
            :summary="summary"
            :note="sale.note"
          />
        </div>
      </div>
    </div>

    <div class="col-xl-4">
      <!-- Balance -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="card-title mb-0">Balance</h5>
            <span v-if="badge" class="badge" :class="badge.className">{{ badge.label }}</span>
          </div>
          <div class="summary-row"><span>Total</span><span>{{ formatPeso(sale.totalCents) }}</span></div>
          <div v-if="sale.returnedCents > 0" class="summary-row">
            <span>Returned</span><span>−{{ formatPeso(sale.returnedCents) }}</span>
          </div>
          <div class="summary-row"><span>Paid</span><span>{{ formatPeso(sale.paidCents) }}</span></div>
          <div class="summary-row summary-due" :class="{ 'text-danger': sale.dueCents > 0 }">
            <span>Balance due</span><span>{{ formatPeso(Math.max(sale.dueCents, 0)) }}</span>
          </div>
          <div class="fs-12 text-gray-5 mt-2">
            Sold by {{ sale.userName }} · {{ formatDateTime(sale.createdAt) }}
            <template v-if="sale.source === 'pos'"> · POS</template>
          </div>
          <div v-if="sale.quotation" class="fs-12 mt-1">
            From quotation
            <RouterLink :to="{ name: 'quotation-detail', params: { id: sale.quotation.id } }">
              {{ sale.quotation.reference }}
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- Payments -->
      <div class="card mb-3">
        <div class="card-body">
          <h5 class="card-title mb-2">Payments</h5>
          <div v-if="sale.payments.length === 0" class="text-gray-5 fs-14">No payments yet.</div>
          <div v-for="payment in sale.payments" :key="payment.id" class="list-row">
            <div class="min-w-0">
              <div class="text-gray-9">
                {{ payment.amountCents < 0 ? 'Refund' : 'Payment' }} · {{ paymentMethodLabel(payment.method) }}
              </div>
              <div class="fs-12 text-gray-5 text-break">
                {{ formatIsoDate(payment.paidDate) }} · {{ payment.userName }}
                <template v-if="payment.reference"> · Ref {{ payment.reference }}</template>
                <template v-if="payment.return"> · {{ payment.return.reference }}</template>
                <template v-if="payment.changeCents"> · Change {{ formatPeso(payment.changeCents) }}</template>
              </div>
              <div v-if="payment.note && !payment.return" class="fs-12 text-gray-5 text-break">{{ payment.note }}</div>
            </div>
            <div class="fw-semibold text-nowrap" :class="payment.amountCents < 0 ? 'text-danger' : 'text-success'">
              {{ payment.amountCents < 0 ? '−' : '' }}{{ formatPeso(Math.abs(payment.amountCents)) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Returns -->
      <div v-if="sale.returns.length > 0" class="card mb-0">
        <div class="card-body">
          <h5 class="card-title mb-2">Returns</h5>
          <RouterLink
            v-for="ret in sale.returns"
            :key="ret.id"
            :to="{ name: 'sales-returns', query: { view: ret.id } }"
            class="list-row list-link"
          >
            <div class="min-w-0">
              <div class="text-primary fw-medium">{{ ret.reference }}</div>
              <div class="fs-12 text-gray-5">{{ formatIsoDate(ret.returnDate) }} · {{ returnReasonLabel(ret.reason) }}</div>
            </div>
            <div class="text-end text-nowrap">
              <div class="fw-semibold text-gray-9">{{ formatPeso(ret.totalCents) }}</div>
              <div v-if="ret.refundCents > 0" class="fs-12 text-danger">Refunded {{ formatPeso(ret.refundCents) }}</div>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>

  <!-- The copy that prints (hidden on screen) -->
  <Teleport to="body">
    <div v-if="sale" class="print-root">
      <ReceiptDocument v-if="printMode === 'receipt'" :sale="sale" :store="store" />
      <InvoiceDocument
        v-else
        title="Invoice"
        :reference="sale.reference"
        :store="store"
        :customer="sale.customer"
        :dates="dates"
        :status="badge"
        :items="documentItems"
        :totals="sale"
        :summary="summary"
        :note="sale.note"
      />
    </div>
  </Teleport>

  <PaymentFormModal v-if="paying && sale" :sale="sale" @close="paying = false" @saved="onPaid" />
</template>

<style scoped>
.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.summary-due {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #e6eaed;
  font-size: 16px;
  font-weight: 700;
}

.list-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f2f4f7;
}

.list-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.list-link {
  color: inherit;
}

.list-link:hover {
  background: #fffaf5;
}

.badge {
  font-weight: 500;
}

.min-w-0 {
  min-width: 0;
}

@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions > * {
    flex: 1 1 auto;
  }
}
</style>
