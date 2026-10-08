<script setup lang="ts">
// Sales (/sales) and Invoices (/invoices). Every sale is also its invoice; the Sales page
// reads like a sales log, the Invoices page focuses on what's been paid and what's owed.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  invoiceBadge,
  listSales,
  type PaymentStatus,
  type Sale,
  type SaleQuery,
  type SaleSource,
  type SaleSummary,
  type SaleSums,
} from '@/api/sales'
import { can } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { PERIOD_OPTIONS, periodDates, rangeError, type Period } from '@/utils/period'
import PaymentFormModal from './PaymentFormModal.vue'
import { formatMoney } from '@/utils/money'

const props = defineProps<{ mode: 'sales' | 'invoices' }>()

const router = useRouter()
const isInvoices = computed(() => props.mode === 'invoices')
const canSell = computed(() => can('sales.create'))
const today = toIsoDate()

// --- List, filters and paging ---

const items = ref<SaleSummary[]>([])
const total = ref(0)
const sums = ref<SaleSums>({ totalCents: 0, paidCents: 0, dueCents: 0 })
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const paymentFilter = ref<'' | PaymentStatus | 'due' | 'overdue'>('')
const sourceFilter = ref<'' | SaleSource>('')
const period = ref<Period>('')
const customFrom = ref('')
const customTo = ref('')
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(
  () => search.value !== '' || paymentFilter.value !== '' || sourceFilter.value !== '' || period.value !== '',
)
const customRangeError = computed(() => rangeError(period.value, customFrom.value, customTo.value))

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loadError.value = ''
  if (customRangeError.value) {
    items.value = []
    total.value = 0
    loading.value = false
    return
  }
  loading.value = true
  const range = periodDates(period.value, customFrom.value, customTo.value)
  const query: SaleQuery = {
    search: search.value.trim(),
    payment: paymentFilter.value,
    source: sourceFilter.value,
    from: range.from,
    to: range.to,
    today,
    page: page.value,
    pageSize: pageSize.value,
  }
  try {
    const result = await listSales(query)
    if (requestId !== latestRequest) return // a newer search already went out

    if (result.items.length === 0 && page.value > 1 && result.total > 0) {
      page.value = Math.ceil(result.total / pageSize.value)
      return
    }
    items.value = result.items
    total.value = result.total
    sums.value = result.sums
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load sales'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function resetToFirstPage() {
  if (page.value === 1) load()
  else page.value = 1 // the page watcher reloads
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(resetToFirstPage, 300)
})
watch([paymentFilter, sourceFilter, period, customFrom, customTo, pageSize], resetToFirstPage)
watch(page, load)
load()

function clearFilters() {
  search.value = ''
  paymentFilter.value = ''
  sourceFilter.value = ''
  period.value = ''
  customFrom.value = ''
  customTo.value = ''
}

const detailRoute = (sale: SaleSummary) => ({
  name: isInvoices.value ? 'invoice-detail' : 'sale-detail',
  params: { id: sale.id },
})

function open(sale: SaleSummary) {
  router.push(detailRoute(sale))
}

// --- Record payment ---

const paying = ref<SaleSummary | null>(null)

function onPaid(sale: Sale) {
  paying.value = null
  const index = items.value.findIndex((item) => item.id === sale.id)
  if (index !== -1) items.value[index] = sale
  load() // the totals and filters may have changed
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ isInvoices ? 'Invoices' : 'Sales' }}</h4>
      <h6>{{ isInvoices ? 'Track payments and balances due' : 'Every sale, newest first' }}</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <RouterLink v-if="canSell && !isInvoices" :to="{ name: 'pos' }" class="btn btn-dark">
        <i class="ti ti-device-laptop me-1"></i>POS
      </RouterLink>
      <RouterLink v-if="canSell" :to="{ name: 'sale-create' }" class="btn btn-primary">
        <i class="ti ti-circle-plus me-1"></i>New Sale
      </RouterLink>
    </div>
  </div>

  <!-- Totals for the current filters -->
  <div class="row g-3 mb-3">
    <div class="col-12 col-sm-4">
      <div class="stat-card">
        <span class="stat-icon bg-primary-transparent"><i class="ti ti-receipt"></i></span>
        <div class="min-w-0">
          <div class="fs-13 text-gray-5">{{ isInvoices ? 'Invoiced' : 'Sales' }} ({{ total }})</div>
          <div class="stat-value">{{ formatMoney(sums.totalCents) }}</div>
        </div>
      </div>
    </div>
    <div class="col-6 col-sm-4">
      <div class="stat-card">
        <span class="stat-icon bg-success-transparent"><i class="ti ti-cash"></i></span>
        <div class="min-w-0">
          <div class="fs-13 text-gray-5">Paid</div>
          <div class="stat-value">{{ formatMoney(sums.paidCents) }}</div>
        </div>
      </div>
    </div>
    <div class="col-6 col-sm-4">
      <div class="stat-card">
        <span class="stat-icon bg-danger-transparent"><i class="ti ti-alert-circle"></i></span>
        <div class="min-w-0">
          <div class="fs-13 text-gray-5">Balance due</div>
          <div class="stat-value">{{ formatMoney(sums.dueCents) }}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <!-- Search and filters -->
    <div class="card-header">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div class="search-set">
          <div class="search-input">
            <span class="search-icon"><i class="ti ti-search"></i></span>
            <input
              v-model="search"
              type="search"
              class="form-control"
              placeholder="Search invoice no., customer or note"
              aria-label="Search sales"
            />
          </div>
        </div>
        <div class="filters d-flex flex-wrap gap-2">
          <select v-model="paymentFilter" class="form-select" aria-label="Filter by payment status">
            <option value="">All payments</option>
            <option value="paid">Paid</option>
            <option value="partial">Partially paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="due">With balance due</option>
            <option value="overdue">Overdue</option>
          </select>
          <select v-if="!isInvoices" v-model="sourceFilter" class="form-select" aria-label="Filter by source">
            <option value="">POS &amp; manual</option>
            <option value="pos">POS</option>
            <option value="manual">Manual</option>
          </select>
          <select v-model="period" class="form-select" aria-label="Filter by date">
            <option v-for="p in PERIOD_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
      </div>
      <div v-if="period === 'custom'" class="custom-range d-flex flex-wrap align-items-center gap-2 mt-2">
        <input v-model="customFrom" type="date" class="form-control" aria-label="From date" />
        <span class="text-gray-5">to</span>
        <input v-model="customTo" type="date" class="form-control" aria-label="To date" />
        <div v-if="customRangeError" class="text-danger fs-13 w-100">{{ customRangeError }}</div>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (wide screens) -->
      <div class="table-responsive d-none d-xl-block">
        <table class="table table-hover mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th v-if="isInvoices">Due Date</th>
              <th v-else class="text-end">Items</th>
              <th class="text-end">Total</th>
              <th class="text-end">Paid</th>
              <th class="text-end">Balance</th>
              <th>Status</th>
              <th v-if="isInvoices" class="text-end">Actions</th>
              <th v-else>Cashier</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sale in items" :key="sale.id" class="clickable" @click="open(sale)">
              <td>
                <RouterLink :to="detailRoute(sale)" class="fw-medium" @click.stop>{{ sale.reference }}</RouterLink>
                <div class="fs-12 text-gray-5">
                  {{ formatIsoDate(sale.saleDate) }}<template v-if="sale.source === 'pos'"> · POS</template>
                </div>
              </td>
              <td>
                <div class="customer-name text-gray-9">{{ sale.customer.name }}</div>
                <div v-if="sale.customer.phone" class="fs-12 text-gray-5">{{ sale.customer.phone }}</div>
              </td>
              <td v-if="isInvoices">
                <span :class="{ 'text-danger fw-medium': sale.dueCents > 0 && sale.dueDate && sale.dueDate < today }">
                  {{ sale.dueDate ? formatIsoDate(sale.dueDate) : '—' }}
                </span>
              </td>
              <td v-else class="text-end">{{ sale.itemCount }}</td>
              <td class="text-end fw-medium text-gray-9">
                {{ formatMoney(sale.totalCents - sale.returnedCents) }}
                <div v-if="sale.returnedCents > 0" class="fs-12 text-gray-5 fw-normal">
                  of {{ formatMoney(sale.totalCents) }}
                </div>
              </td>
              <td class="text-end">{{ formatMoney(sale.paidCents) }}</td>
              <td class="text-end" :class="sale.dueCents > 0 ? 'text-danger fw-medium' : 'text-gray-5'">
                {{ formatMoney(Math.max(sale.dueCents, 0)) }}
              </td>
              <td>
                <span class="badge" :class="invoiceBadge(sale, today).className">{{ invoiceBadge(sale, today).label }}</span>
              </td>
              <td v-if="isInvoices" class="text-end">
                <div class="row-actions">
                  <button
                    v-if="canSell && sale.dueCents > 0"
                    type="button"
                    title="Record payment"
                    @click.stop="paying = sale"
                  >
                    <i class="ti ti-cash"></i>
                  </button>
                  <RouterLink :to="detailRoute(sale)" title="View invoice" @click.stop><i class="ti ti-eye"></i></RouterLink>
                </div>
              </td>
              <td v-else class="text-gray-5">{{ sale.userName }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones, tablets and small laptops) -->
      <div class="d-xl-none sale-cards" :class="{ 'is-loading': loading }">
        <div v-for="sale in items" :key="sale.id" class="sale-card">
          <RouterLink :to="detailRoute(sale)" class="sale-card-link">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div class="min-w-0">
                <div class="fw-semibold text-primary">{{ sale.reference }}</div>
                <div class="text-gray-9 text-break">{{ sale.customer.name }}</div>
              </div>
              <div class="text-end flex-shrink-0">
                <div class="fw-semibold text-gray-9">{{ formatMoney(sale.totalCents - sale.returnedCents) }}</div>
                <span class="badge" :class="invoiceBadge(sale, today).className">{{ invoiceBadge(sale, today).label }}</span>
              </div>
            </div>
            <div class="d-flex flex-wrap justify-content-between gap-2 fs-12 text-gray-5 mt-1">
              <span>
                {{ formatIsoDate(sale.saleDate) }}<template v-if="sale.source === 'pos'"> · POS</template>
                · {{ sale.itemCount }} {{ sale.itemCount === 1 ? 'item' : 'items' }}
              </span>
              <span v-if="sale.dueCents > 0" class="text-danger fw-medium">
                Due {{ formatMoney(sale.dueCents) }}<template v-if="sale.dueDate"> by {{ formatIsoDate(sale.dueDate) }}</template>
              </span>
            </div>
          </RouterLink>
          <button
            v-if="canSell && isInvoices && sale.dueCents > 0"
            type="button"
            class="btn btn-sm btn-outline-primary w-100 mt-2"
            @click="paying = sale"
          >
            <i class="ti ti-cash me-1"></i>Record Payment
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-file-invoice fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">
          Nothing matches your filters.
          <button type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="clearFilters">Clear filters</button>
        </template>
        <template v-else>
          No sales yet.
          <RouterLink :to="{ name: 'pos' }" class="d-block mt-2">Open the POS to make your first sale</RouterLink>
        </template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" :label="isInvoices ? 'Invoice pages' : 'Sale pages'" />
  </div>

  <PaymentFormModal v-if="paying" :sale="paying" @close="paying = null" @saved="onPaid" />
</template>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  font-size: 20px;
}

.bg-primary-transparent {
  background: #fff6ee;
  color: #fe9f43;
}

.bg-success-transparent {
  background: #eafaf2;
  color: #3eb780;
}

.bg-danger-transparent {
  background: #ffeeec;
  color: #ff0000;
}

.stat-value {
  color: #212b36;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-input .search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #a6aaaf;
  pointer-events: none;
}

.search-input input {
  padding-left: 32px;
  min-width: 280px;
}

.filters .form-select {
  width: auto;
  min-width: 140px;
  max-width: 190px;
}

.custom-range .form-control {
  width: auto;
  min-width: 150px;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.clickable {
  cursor: pointer;
}

.customer-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  font-weight: 500;
  font-size: 11px;
}

.row-actions {
  display: inline-flex;
  gap: 8px;
}

.row-actions > * {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #212b36;
}

.row-actions > *:hover {
  background: #e6eaed;
}

.sale-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.sale-card:last-child {
  border-bottom: 0;
}

.sale-card-link {
  display: block;
  color: inherit;
}

/* Tablets: two cards per row */
@media (min-width: 768px) {
  .sale-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .sale-card:nth-child(odd) {
    border-right: 1px solid #e6eaed;
  }

  .sale-card:nth-last-child(2):nth-child(odd) {
    border-bottom: 0;
  }
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

@media (max-width: 767.98px) {
  .search-set,
  .search-input,
  .search-input input,
  .filters {
    width: 100%;
    min-width: 0;
  }

  .filters .form-select {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
    max-width: none;
  }

  .custom-range .form-control {
    flex: 1 1 0;
    min-width: 0;
  }

  .stat-value {
    font-size: 16px;
  }
}

@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary,
  .page-actions .btn-dark {
    flex: 1;
  }
}
</style>
