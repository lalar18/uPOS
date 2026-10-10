<script setup lang="ts">
// The platform owner's income for a year: subscriptions, the service charges added to online
// payments, less what PayMongo kept; by month and by store. Also where the charges are set.
import { computed, ref, watch } from 'vue'
import { paymentMethodLabel } from '@/api/sales'
import type { ServiceCharge } from '@/api/serviceCharge'
import { storeCode } from '@/api/store'
import { getIncome, getServiceCharges, type Income, type ServiceCharges } from '@/api/usPanel'
import { formatMoney, formatPercentBp } from '@/utils/money'
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
      note: `${peso(t.renewalChargesCents)} renewals · ${peso(t.saleChargesCents)} sales`,
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
      <h6>Subscriptions and service charges, less PayMongo fees</h6>
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

    <!-- By month -->
    <div class="card">
      <div class="card-header"><h5 class="card-title mb-0">By month</h5></div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table mb-0" :class="{ 'is-loading': loading }">
            <thead class="thead-light">
              <tr>
                <th>Month</th>
                <th class="text-end">Subscriptions</th>
                <th class="text-end">Renewal charges</th>
                <th class="text-end">Sale charges</th>
                <th class="text-end">PayMongo fees</th>
                <th class="text-end">Net income</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in shownMonths" :key="m.month">
                <td>{{ monthLabel(m.month) }}</td>
                <td class="text-end">
                  {{ peso(m.subscriptionsCents) }}
                  <div class="fs-12 text-gray-5">{{ m.renewals }} renewal{{ m.renewals === 1 ? '' : 's' }}</div>
                </td>
                <td class="text-end">{{ peso(m.renewalChargesCents) }}</td>
                <td class="text-end">
                  {{ peso(m.saleChargesCents) }}
                  <div class="fs-12 text-gray-5">{{ m.salePayments }} payment{{ m.salePayments === 1 ? '' : 's' }}</div>
                </td>
                <td class="text-end text-danger">{{ m.processingFeesCents ? `−${peso(m.processingFeesCents)}` : peso(0) }}</td>
                <td class="text-end fw-bold text-gray-9">{{ peso(m.netCents) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="fw-bold">
                <td>Total</td>
                <td class="text-end">{{ peso(income.totals.subscriptionsCents) }}</td>
                <td class="text-end">{{ peso(income.totals.renewalChargesCents) }}</td>
                <td class="text-end">{{ peso(income.totals.saleChargesCents) }}</td>
                <td class="text-end text-danger">
                  {{ income.totals.processingFeesCents ? `−${peso(income.totals.processingFeesCents)}` : peso(0) }}
                </td>
                <td class="text-end text-gray-9">{{ peso(income.totals.netCents) }}</td>
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
          <table class="table mb-0" :class="{ 'is-loading': loading }">
            <thead class="thead-light">
              <tr>
                <th>Store</th>
                <th class="text-end">Subscriptions</th>
                <th class="text-end">Renewal charges</th>
                <th class="text-end">Sale charges</th>
                <th class="text-end">PayMongo fees</th>
                <th class="text-end">Net income</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in income.stores" :key="s.id">
                <td>
                  <RouterLink :to="{ name: 'us-store', params: { id: s.id } }" class="fw-medium text-gray-9">{{ s.name }}</RouterLink>
                  <div class="fs-12 text-gray-5">{{ storeCode(s.id) }}</div>
                </td>
                <td class="text-end">{{ peso(s.subscriptionsCents) }}</td>
                <td class="text-end">{{ peso(s.renewalChargesCents) }}</td>
                <td class="text-end">{{ peso(s.saleChargesCents) }}</td>
                <td class="text-end text-danger">{{ s.processingFeesCents ? `−${peso(s.processingFeesCents)}` : peso(0) }}</td>
                <td class="text-end fw-bold text-gray-9">{{ peso(s.netCents) }}</td>
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
</template>
