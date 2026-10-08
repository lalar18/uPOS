<script setup lang="ts">
// Quotations (/quotations), newest first.
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatPeso } from '@/api/products'
import {
  listQuotations,
  QUOTATION_STATUSES,
  quotationBadge,
  quotationStatusLabel,
  type QuotationStatus,
  type QuotationSummary,
} from '@/api/quotations'
import { can } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { PERIOD_OPTIONS, periodDates, rangeError, type Period } from '@/utils/period'

const router = useRouter()
const today = toIsoDate()
const STATUS_FILTERS: (QuotationStatus | 'expired')[] = [...QUOTATION_STATUSES, 'expired', 'converted']

const items = ref<QuotationSummary[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<'' | QuotationStatus | 'expired'>('')
const period = ref<Period>('')
const customFrom = ref('')
const customTo = ref('')
const page = ref(1)
const pageSize = ref(10)

const canManage = computed(() => can('quotations.manage'))
const hasFilters = computed(() => search.value !== '' || statusFilter.value !== '' || period.value !== '')
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
    const result = await listQuotations({
      search: search.value.trim(),
      status: statusFilter.value,
      from: range.from,
      to: range.to,
      today,
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
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load quotations'
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
watch([statusFilter, period, customFrom, customTo, pageSize], resetToFirstPage)
watch(page, load)
load()

function clearFilters() {
  search.value = ''
  statusFilter.value = ''
  period.value = ''
  customFrom.value = ''
  customTo.value = ''
}

const detailRoute = (q: QuotationSummary) => ({ name: 'quotation-detail', params: { id: q.id } })
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Quotation</h4>
      <h6>Price offers for your customers</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <RouterLink v-if="canManage" :to="{ name: 'quotation-create' }" class="btn btn-primary">
        <i class="ti ti-circle-plus me-1"></i>New Quotation
      </RouterLink>
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
              placeholder="Search quotation no., customer or note"
              aria-label="Search quotations"
            />
          </div>
        </div>
        <div class="filters d-flex flex-wrap gap-2">
          <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option v-for="s in STATUS_FILTERS" :key="s" :value="s">{{ quotationStatusLabel(s) }}</option>
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
              <th>Quotation</th>
              <th>Customer</th>
              <th>Valid Until</th>
              <th class="text-end">Items</th>
              <th class="text-end">Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in items" :key="q.id" class="clickable" @click="router.push(detailRoute(q))">
              <td>
                <RouterLink :to="detailRoute(q)" class="fw-medium" @click.stop>{{ q.reference }}</RouterLink>
                <div class="fs-12 text-gray-5">{{ formatIsoDate(q.quoteDate) }} · {{ q.userName }}</div>
              </td>
              <td><div class="customer-name text-gray-9">{{ q.customer.name }}</div></td>
              <td>{{ q.validUntil ? formatIsoDate(q.validUntil) : '—' }}</td>
              <td class="text-end">{{ q.itemCount }}</td>
              <td class="text-end fw-medium text-gray-9">{{ formatPeso(q.totalCents) }}</td>
              <td>
                <span class="badge" :class="quotationBadge(q, today).className">{{ quotationBadge(q, today).label }}</span>
                <div v-if="q.sale" class="fs-12 text-gray-5">{{ q.sale.reference }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones and tablets) -->
      <div class="d-lg-none entry-cards" :class="{ 'is-loading': loading }">
        <RouterLink v-for="q in items" :key="q.id" :to="detailRoute(q)" class="entry-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0">
              <div class="fw-semibold text-primary">{{ q.reference }}</div>
              <div class="text-gray-9 text-break">{{ q.customer.name }}</div>
            </div>
            <div class="text-end flex-shrink-0">
              <div class="fw-semibold text-gray-9">{{ formatPeso(q.totalCents) }}</div>
              <span class="badge" :class="quotationBadge(q, today).className">{{ quotationBadge(q, today).label }}</span>
            </div>
          </div>
          <div class="fs-12 text-gray-5 mt-1">
            {{ formatIsoDate(q.quoteDate) }} · {{ q.itemCount }} {{ q.itemCount === 1 ? 'item' : 'items' }}
            <template v-if="q.validUntil"> · valid until {{ formatIsoDate(q.validUntil) }}</template>
          </div>
        </RouterLink>
      </div>

      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-file-description fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">
          No quotations match your filters.
          <button type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="clearFilters">Clear filters</button>
        </template>
        <template v-else>
          No quotations yet.
          <RouterLink v-if="canManage" :to="{ name: 'quotation-create' }" class="d-block mt-2">Create your first quotation</RouterLink>
        </template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Quotation pages" />
  </div>
</template>

<style scoped>
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
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  font-weight: 500;
  font-size: 11px;
}

.entry-card {
  display: block;
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
  color: inherit;
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
