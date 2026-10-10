<script setup lang="ts">
// The platform owner's income for a year: subscriptions, the service charges added to payments
// made online through PayMongo, less what PayMongo kept. Broken down by source, plan, payment
// method, month and store, down to each payment it came from. Also where the charges are set.
import { computed, ref, watch } from 'vue'
import { paymentMethodLabel } from '@/api/sales'
import type { ServiceCharge } from '@/api/serviceCharge'
import { storeCode } from '@/api/store'
import { getIncome, getServiceCharges, type Income, type ServiceCharges } from '@/api/usPanel'
import { formatMoney, formatPercentBp } from '@/utils/money'
import UsIncomeEntriesModal from './UsIncomeEntriesModal.vue'
import UsServiceChargeModal from './UsServiceChargeModal.vue'

const thisYear = new Date().getFullYear()
const year = ref(thisYear)
const income = ref<Income | null>(null)
const charges = ref<ServiceCharges | null>(null)
const loading = ref(false)
const loadError = ref('')
const notice = ref('')
const editingCharges = ref(false)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const [result, current] = await Promise.all([getIncome(year.value), getServiceCharges()])
    if (requestId !== latestRequest) return
    income.value = result
    charges.value = current
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load income'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}
watch(year, load)
load()

// --- Income entries (each payment the income came from), in a modal ---

/** The month (1-12) or store the entries modal opened for; null when it's closed */
const entriesFor = ref<{ month: number | null; store: number | null } | null>(null)

/** Opens the entries of a month or a store (from the tables), or of the whole year */
function showEntries(filter: { month?: string; store?: number } = {}) {
  entriesFor.value = { month: filter.month ? Number(filter.month.slice(5, 7)) : null, store: filter.store ?? null }
}

// --- Where the income came from ---

const breakdown = computed(() => {
  const i = income.value
  if (!i) return null
  const t = i.totals
  const onlineRenewals = i.sources.plans.reduce((n, p) => n + p.online, 0)
  const onlineSubscriptions = i.sources.plans.reduce((n, p) => n + p.onlineCents, 0)
  const renewalCharged = i.sources.methods.reduce((n, m) => n + m.renewals, 0)
  return {
    online: { count: onlineRenewals, cents: onlineSubscriptions },
    byHand: { count: t.renewals - onlineRenewals, cents: t.subscriptionsCents - onlineSubscriptions },
    renewalCharges: { count: renewalCharged, cents: t.renewalChargesCents },
    saleCharges: { count: t.salePayments, cents: t.saleChargesCents },
    grossCents: t.subscriptionsCents + t.renewalChargesCents + t.saleChargesCents,
    heldForStoresCents: i.sources.methods.reduce((n, m) => n + m.storeCents, 0),
  }
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const years = computed(() => {
  const first = Math.min(income.value?.firstYear ?? thisYear, thisYear)
  return Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i)
})

const peso = (cents: number) => formatMoney(cents, 'PHP')

function describeCharge(charge: ServiceCharge): string {
  if (charge.value <= 0) return 'Off'
  return charge.kind === 'fixed' ? `${peso(charge.value)} per payment` : `${formatPercentBp(charge.value)} of the payment`
}

const summaryCards = computed(() => {
  const t = income.value?.totals
  if (!t) return []
  return [
    { label: 'Subscriptions', value: t.subscriptionsCents, icon: 'crown', color: 'primary', note: `${t.renewals} renewal${t.renewals === 1 ? '' : 's'} paid` },
    {
      label: 'Service charges',
      value: t.renewalChargesCents + t.saleChargesCents,
      icon: 'receipt-tax',
      color: 'info',
      note: `Online only · ${peso(t.renewalChargesCents)} renewals · ${peso(t.saleChargesCents)} sales`,
    },
    { label: 'PayMongo fees', value: -t.processingFeesCents, icon: 'building-bank', color: 'danger', note: 'Kept by PayMongo' },
    { label: 'Net income', value: t.netCents, icon: 'cash', color: 'success', note: `For ${income.value!.year}` },
  ]
})

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/** Months up to now (the whole year for past years) */
const shownMonths = computed(() => {
  const months = income.value?.months ?? []
  if (income.value?.year !== thisYear) return months
  return months.slice(0, new Date().getMonth() + 1).reverse()
})

function onChargesSaved(saved: ServiceCharges) {
  charges.value = saved
  editingCharges.value = false
  notice.value = 'Service charges saved. They apply to new payments from now on.'
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Income</h4>
      <h6>Subscriptions and service charges on online payments, less PayMongo fees</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <select v-model.number="year" class="form-select" aria-label="Year">
        <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
      </select>
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <!-- Service charge settings -->
  <div v-if="charges" class="card">
    <div class="card-body d-flex flex-wrap align-items-center justify-content-between gap-3">
      <div class="d-flex flex-wrap gap-4">
        <div>
          <div class="fs-12 text-gray-5">Renewals paid online</div>
          <div class="fw-medium text-gray-9">{{ describeCharge(charges.renewal) }}</div>
        </div>
        <div>
          <div class="fs-12 text-gray-5">Store sale payments</div>
          <div class="fw-medium text-gray-9">{{ describeCharge(charges.sale) }}</div>
          <div v-if="charges.sale.value > 0" class="fs-12 text-gray-5">
            {{ charges.sale.methods.map(paymentMethodLabel).join(', ') || 'No methods chosen' }}
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-outline-primary" @click="editingCharges = true">
        <i class="ti ti-adjustments me-1"></i>Service Charges
      </button>
    </div>
  </div>

  <template v-if="income">
    <div class="row g-3 mb-4" :class="{ 'is-loading': loading }">
      <div v-for="card in summaryCards" :key="card.label" class="col-sm-6 col-xl-3">
        <div class="card h-100 mb-0">
          <div class="card-body d-flex align-items-center gap-3">
            <span class="avatar avatar-lg rounded-circle flex-shrink-0" :class="`bg-${card.color}-transparent text-${card.color}`">
              <i class="ti fs-24" :class="`ti-${card.icon}`"></i>
            </span>
            <div class="min-w-0">
              <div class="fs-13 text-gray-5">{{ card.label }}</div>
              <div class="fs-20 fw-bold text-gray-9">{{ peso(card.value) }}</div>
              <div class="fs-12 text-gray-5 text-truncate">{{ card.note }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Where it came from -->
    <div v-if="breakdown" class="card" :class="{ 'is-loading': loading }">
      <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
        <h5 class="card-title mb-0">Where the income came from</h5>
        <button type="button" class="btn btn-sm btn-outline-primary" @click="showEntries()">
          <i class="ti ti-list-details me-1"></i>View All Entries
        </button>
      </div>
      <div class="card-body p-0">
        <table class="table statement mb-0">
          <tbody>
            <tr class="group">
              <th colspan="2">Subscriptions</th>
              <th class="text-end">{{ peso(income.totals.subscriptionsCents) }}</th>
            </tr>
            <tr>
              <td class="ps-4">Renewals paid online (PayMongo)</td>
              <td class="text-end text-gray-5 fs-13">{{ plural(breakdown.online.count, 'renewal') }}</td>
              <td class="text-end">{{ peso(breakdown.online.cents) }}</td>
            </tr>
            <tr>
              <td class="ps-4">Renewals recorded by a super admin (cash, bank transfer, …)</td>
              <td class="text-end text-gray-5 fs-13">{{ plural(breakdown.byHand.count, 'renewal') }}</td>
              <td class="text-end">{{ peso(breakdown.byHand.cents) }}</td>
            </tr>
            <tr class="group">
              <th colspan="2">Service charges on online payments</th>
              <th class="text-end">{{ peso(breakdown.renewalCharges.cents + breakdown.saleCharges.cents) }}</th>
            </tr>
            <tr>
              <td class="ps-4">On renewals paid online</td>
              <td class="text-end text-gray-5 fs-13">{{ plural(breakdown.renewalCharges.count, 'payment') }}</td>
              <td class="text-end">{{ peso(breakdown.renewalCharges.cents) }}</td>
            </tr>
            <tr>
              <td class="ps-4">On store sales paid online</td>
              <td class="text-end text-gray-5 fs-13">{{ plural(breakdown.saleCharges.count, 'payment') }}</td>
              <td class="text-end">{{ peso(breakdown.saleCharges.cents) }}</td>
            </tr>
            <tr class="group">
              <th colspan="2">Total received</th>
              <th class="text-end">{{ peso(breakdown.grossCents) }}</th>
            </tr>
            <tr>
              <td class="ps-4">Less PayMongo fees</td>
              <td></td>
              <td class="text-end text-danger">
                {{ income.totals.processingFeesCents ? `−${peso(income.totals.processingFeesCents)}` : peso(0) }}
              </td>
            </tr>
            <tr class="net">
              <th colspan="2">Net income</th>
              <th class="text-end">{{ peso(income.totals.netCents) }}</th>
            </tr>
          </tbody>
        </table>
        <p class="fs-12 text-gray-5 px-3 py-2 mb-0 border-top">
          Not income: {{ peso(breakdown.heldForStoresCents) }} of sales paid online belongs to the stores (held in their
          wallets until paid out). Service charges stores add to payments they record by hand are kept by the stores, so
          they aren't counted here.
        </p>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <!-- By plan -->
      <div class="col-lg-6">
        <div class="card h-100 mb-0">
          <div class="card-header"><h5 class="card-title mb-0">Subscriptions by plan</h5></div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table us-stack mb-0" :class="{ 'is-loading': loading }">
                <thead class="thead-light">
                  <tr>
                    <th>Plan</th>
                    <th class="text-end">Renewals</th>
                    <th class="text-end">Income</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in income.sources.plans" :key="p.id">
                    <td class="fw-medium text-gray-9">{{ p.name }}</td>
                    <td class="text-end" data-label="Renewals">
                      {{ p.renewals }}
                      <div class="fs-12 text-gray-5">{{ p.online }} online · {{ plural(p.months, 'month') }}</div>
                    </td>
                    <td class="text-end" data-label="Income">{{ peso(p.cents) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="income.sources.plans.length === 0" class="text-center text-gray-5 py-4 fs-14">
              No subscriptions paid in {{ income.year }}.
            </div>
          </div>
        </div>
      </div>

      <!-- By payment method -->
      <div class="col-lg-6">
        <div class="card h-100 mb-0">
          <div class="card-header"><h5 class="card-title mb-0">Online payments by method</h5></div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table us-stack mb-0" :class="{ 'is-loading': loading }">
                <thead class="thead-light">
                  <tr>
                    <th>Method</th>
                    <th class="text-end">Service charges</th>
                    <th class="text-end">PayMongo fees</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in income.sources.methods" :key="m.method">
                    <td>
                      <span class="fw-medium text-gray-9">{{ paymentMethodLabel(m.method) }}</span>
                      <div class="fs-12 text-gray-5">
                        {{ plural(m.renewals, 'renewal') }} · {{ plural(m.salePayments, 'sale payment') }}
                      </div>
                    </td>
                    <td class="text-end" data-label="Service charges">
                      {{ peso(m.renewalChargesCents + m.saleChargesCents) }}
                      <div class="fs-12 text-gray-5">
                        {{ peso(m.renewalChargesCents) }} renewals · {{ peso(m.saleChargesCents) }} sales
                      </div>
                    </td>
                    <td class="text-end text-danger" data-label="PayMongo fees">{{ m.processingFeesCents ? `−${peso(m.processingFeesCents)}` : peso(0) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="income.sources.methods.length === 0" class="text-center text-gray-5 py-4 fs-14">
              No online payments in {{ income.year }}.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- By month -->
    <div class="card">
      <div class="card-header"><h5 class="card-title mb-0">By month</h5></div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table us-stack mb-0" :class="{ 'is-loading': loading }">
            <thead class="thead-light">
              <tr>
                <th>Month</th>
                <th class="text-end">Subscriptions</th>
                <th class="text-end">Renewal charges</th>
                <th class="text-end">Sale charges</th>
                <th class="text-end">PayMongo fees</th>
                <th class="text-end">Net income</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in shownMonths" :key="m.month">
                <td class="fw-medium text-gray-9">{{ monthLabel(m.month) }}</td>
                <td class="text-end" data-label="Subscriptions">
                  {{ peso(m.subscriptionsCents) }}
                  <div class="fs-12 text-gray-5">{{ m.renewals }} renewal{{ m.renewals === 1 ? '' : 's' }}</div>
                </td>
                <td class="text-end" data-label="Renewal charges">{{ peso(m.renewalChargesCents) }}</td>
                <td class="text-end" data-label="Sale charges">
                  {{ peso(m.saleChargesCents) }}
                  <div class="fs-12 text-gray-5">{{ m.salePayments }} payment{{ m.salePayments === 1 ? '' : 's' }}</div>
                </td>
                <td class="text-end text-danger" data-label="PayMongo fees">{{ m.processingFeesCents ? `−${peso(m.processingFeesCents)}` : peso(0) }}</td>
                <td class="text-end fw-bold text-gray-9" data-label="Net income">{{ peso(m.netCents) }}</td>
                <td class="text-end stack-corner">
                  <button type="button" class="btn btn-sm btn-link p-0" @click="showEntries({ month: m.month })">Entries</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="fw-bold">
                <td>Total</td>
                <td class="text-end" data-label="Subscriptions">{{ peso(income.totals.subscriptionsCents) }}</td>
                <td class="text-end" data-label="Renewal charges">{{ peso(income.totals.renewalChargesCents) }}</td>
                <td class="text-end" data-label="Sale charges">{{ peso(income.totals.saleChargesCents) }}</td>
                <td class="text-end text-danger" data-label="PayMongo fees">
                  {{ income.totals.processingFeesCents ? `−${peso(income.totals.processingFeesCents)}` : peso(0) }}
                </td>
                <td class="text-end text-gray-9" data-label="Net income">{{ peso(income.totals.netCents) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>

    <!-- By store -->
    <div class="card">
      <div class="card-header"><h5 class="card-title mb-0">By store</h5></div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table us-stack mb-0" :class="{ 'is-loading': loading }">
            <thead class="thead-light">
              <tr>
                <th>Store</th>
                <th class="text-end">Subscriptions</th>
                <th class="text-end">Renewal charges</th>
                <th class="text-end">Sale charges</th>
                <th class="text-end">PayMongo fees</th>
                <th class="text-end">Net income</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in income.stores" :key="s.id">
                <td>
                  <RouterLink :to="{ name: 'us-store', params: { id: s.id } }" class="fw-medium text-gray-9">{{ s.name }}</RouterLink>
                  <div class="fs-12 text-gray-5">{{ storeCode(s.id) }}</div>
                </td>
                <td class="text-end" data-label="Subscriptions">{{ peso(s.subscriptionsCents) }}</td>
                <td class="text-end" data-label="Renewal charges">{{ peso(s.renewalChargesCents) }}</td>
                <td class="text-end" data-label="Sale charges">{{ peso(s.saleChargesCents) }}</td>
                <td class="text-end text-danger" data-label="PayMongo fees">{{ s.processingFeesCents ? `−${peso(s.processingFeesCents)}` : peso(0) }}</td>
                <td class="text-end fw-bold text-gray-9" data-label="Net income">{{ peso(s.netCents) }}</td>
                <td class="text-end stack-corner">
                  <button type="button" class="btn btn-sm btn-link p-0" @click="showEntries({ store: s.id })">Entries</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && income.stores.length === 0" class="text-center text-gray-5 py-5">
          <i class="ti ti-cash fs-24 d-block mb-2"></i>No income in {{ income.year }} yet.
        </div>
      </div>
    </div>
  </template>

  <UsServiceChargeModal v-if="editingCharges && charges" :charges="charges" @close="editingCharges = false" @saved="onChargesSaved" />
  <UsIncomeEntriesModal
    v-if="entriesFor && income"
    :year="income.year"
    :stores="income.stores"
    :month="entriesFor.month"
    :store="entriesFor.store"
    @close="entriesFor = null"
  />
</template>

<style scoped>
.statement th,
.statement td {
  padding-top: 8px;
  padding-bottom: 8px;
}

/* Long line names wrap instead of widening the page on phones */
.table.statement td,
.table.statement th {
  white-space: normal;
}

.table.statement .text-end {
  white-space: nowrap;
}

.statement .group th {
  background: #f9fafb;
  color: #212b36;
}

.statement .net th {
  border-top: 2px solid #dbe0e6;
  color: #212b36;
  font-size: 16px;
}
</style>
