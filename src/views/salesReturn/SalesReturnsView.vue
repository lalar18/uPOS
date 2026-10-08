<script setup lang="ts">
// Sales returns (/sales/returns), newest first. ?sale=<id> opens a new return for that sale
// (the sale page's "Return items" link); ?view=<id> opens a return's details.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatPeso } from '@/api/products'
import {
  listSalesReturns,
  RETURN_REASONS,
  returnReasonLabel,
  type SalesReturn,
  type SalesReturnSummary,
} from '@/api/salesReturns'
import { can } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import { formatIsoDate } from '@/utils/date'
import { PERIOD_OPTIONS, periodDates, rangeError, type Period } from '@/utils/period'
import SalesReturnDetailModal from './SalesReturnDetailModal.vue'
import SalesReturnFormModal from './SalesReturnFormModal.vue'

const route = useRoute()
const router = useRouter()
const canReturn = computed(() => can('sales.returns'))

// --- List, filters and paging ---

const items = ref<SalesReturnSummary[]>([])
const total = ref(0)
const sums = ref({ totalCents: 0, refundCents: 0 })
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const reasonFilter = ref('')
const period = ref<Period>('')
const customFrom = ref('')
const customTo = ref('')
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(() => search.value !== '' || reasonFilter.value !== '' || period.value !== '')
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
  try {
    const result = await listSalesReturns({
      search: search.value.trim(),
      reason: reasonFilter.value,
      from: range.from,
      to: range.to,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return

    if (result.items.length === 0 && page.value > 1 && result.total > 0) {
      page.value = Math.ceil(result.total / pageSize.value)
      return
    }
    items.value = result.items
    total.value = result.total
    sums.value = result.sums
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load returns'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function resetToFirstPage() {
  if (page.value === 1) load()
  else page.value = 1
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(resetToFirstPage, 300)
})
watch([reasonFilter, period, customFrom, customTo, pageSize], resetToFirstPage)
watch(page, load)
load()

function clearFilters() {
  search.value = ''
  reasonFilter.value = ''
  period.value = ''
  customFrom.value = ''
  customTo.value = ''
}

// --- Dialogs ---

const formOpen = ref(false)
const formSaleId = ref<number | null>(null)
const viewingId = ref<number | null>(null)

function openForm(saleId: number | null) {
  formSaleId.value = saleId
  formOpen.value = true
}

function onSaved(saved: SalesReturn) {
  formOpen.value = false
  resetToFirstPage()
  viewingId.value = saved.id
}

// ?sale=<id> and ?view=<id> open a dialog, then drop the param so a refresh doesn't reopen it
watch(
  () => [route.query.sale, route.query.view],
  ([saleParam, viewParam]) => {
    const saleId = Number(saleParam)
    const viewId = Number(viewParam)
    if (!saleParam && !viewParam) return
    router.replace({ query: { ...route.query, sale: undefined, view: undefined } })
    if (Number.isSafeInteger(saleId) && saleId > 0 && canReturn.value) openForm(saleId)
    else if (Number.isSafeInteger(viewId) && viewId > 0) viewingId.value = viewId
  },
  { immediate: true },
)
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Sales Return</h4>
      <h6>Goods customers brought back, newest first</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="canReturn" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>New Return
      </button>
    </div>
  </div>

  <div class="row g-3 mb-3">
    <div class="col-6">
      <div class="stat-card">
        <span class="stat-icon bg-warning-transparent"><i class="ti ti-receipt-refund"></i></span>
        <div class="min-w-0">
          <div class="fs-13 text-gray-5">Returned ({{ total }})</div>
          <div class="stat-value">{{ formatPeso(sums.totalCents) }}</div>
        </div>
      </div>
    </div>
    <div class="col-6">
      <div class="stat-card">
        <span class="stat-icon bg-danger-transparent"><i class="ti ti-cash-banknote"></i></span>
        <div class="min-w-0">
          <div class="fs-13 text-gray-5">Refunded</div>
          <div class="stat-value">{{ formatPeso(sums.refundCents) }}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div class="search-set">
          <div class="search-input">
            <span class="search-icon"><i class="ti ti-search"></i></span>
            <input
              v-model="search"
              type="search"
              class="form-control"
              placeholder="Search return no., invoice no. or customer"
              aria-label="Search returns"
            />
          </div>
        </div>
        <div class="filters d-flex flex-wrap gap-2">
          <select v-model="reasonFilter" class="form-select" aria-label="Filter by reason">
            <option value="">All reasons</option>
            <option v-for="r in RETURN_REASONS" :key="r" :value="r">{{ returnReasonLabel(r) }}</option>
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
      <div class="table-responsive d-none d-lg-block">
        <table class="table table-hover mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Return</th>
              <th>Sale</th>
              <th>Customer</th>
              <th>Reason</th>
              <th class="text-end">Credited</th>
              <th class="text-end">Refunded</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in items" :key="entry.id" class="clickable" @click="viewingId = entry.id">
              <td>
                <div class="fw-medium text-primary">{{ entry.reference }}</div>
                <div class="fs-12 text-gray-5">{{ formatIsoDate(entry.returnDate) }} · {{ entry.userName }}</div>
              </td>
              <td>
                <RouterLink :to="{ name: 'sale-detail', params: { id: entry.sale.id } }" @click.stop>
                  {{ entry.sale.reference }}
                </RouterLink>
              </td>
              <td><div class="customer-name">{{ entry.customer.name }}</div></td>
              <td>
                <div>{{ returnReasonLabel(entry.reason) }}</div>
                <div class="fs-12 text-gray-5">{{ entry.itemCount }} {{ entry.itemCount === 1 ? 'item' : 'items' }}</div>
              </td>
              <td class="text-end fw-medium text-gray-9">{{ formatPeso(entry.totalCents) }}</td>
              <td class="text-end" :class="entry.refundCents > 0 ? 'text-danger' : 'text-gray-5'">
                {{ formatPeso(entry.refundCents) }}
              </td>
              <td>
                <span class="badge" :class="entry.restock ? 'bg-success' : 'bg-secondary'">
                  {{ entry.restock ? 'Restocked' : 'Not restocked' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones and tablets) -->
      <div class="d-lg-none entry-cards" :class="{ 'is-loading': loading }">
        <button v-for="entry in items" :key="entry.id" type="button" class="entry-card" @click="viewingId = entry.id">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0 text-start">
              <div class="fw-semibold text-primary">{{ entry.reference }} <span class="text-gray-5 fw-normal">· {{ entry.sale.reference }}</span></div>
              <div class="text-gray-9 text-break">{{ entry.customer.name }}</div>
            </div>
            <div class="text-end flex-shrink-0">
              <div class="fw-semibold text-gray-9">{{ formatPeso(entry.totalCents) }}</div>
              <div v-if="entry.refundCents > 0" class="fs-12 text-danger">Refunded {{ formatPeso(entry.refundCents) }}</div>
            </div>
          </div>
          <div class="fs-12 text-gray-5 mt-1 text-start">
            {{ formatIsoDate(entry.returnDate) }} · {{ returnReasonLabel(entry.reason) }} ·
            {{ entry.restock ? 'Restocked' : 'Not restocked' }}
          </div>
        </button>
      </div>

      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-receipt-refund fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">
          No returns match your filters.
          <button type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="clearFilters">Clear filters</button>
        </template>
        <template v-else>No sales returns yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Return pages" />
  </div>

  <SalesReturnFormModal v-if="formOpen" :sale-id="formSaleId" @close="formOpen = false" @saved="onSaved" />
  <SalesReturnDetailModal v-if="viewingId !== null" :id="viewingId" @close="viewingId = null" />
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

.bg-warning-transparent {
  background: #fff6ee;
  color: #fe9f43;
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
  min-width: 300px;
}

.filters .form-select {
  width: auto;
  min-width: 150px;
  max-width: 200px;
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

.entry-card {
  display: block;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid #e6eaed;
  background: #ffffff;
}

.entry-card:last-child {
  border-bottom: 0;
}

@media (min-width: 768px) {
  .entry-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .entry-card:nth-child(odd) {
    border-right: 1px solid #e6eaed;
  }

  .entry-card:nth-last-child(2):nth-child(odd) {
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

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
