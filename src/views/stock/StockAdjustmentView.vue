<script setup lang="ts">
// The stock adjustment log: every change to stock, newest first. Open with ?product=<id>
// (as the product form's "Adjust stock" link does) to start an adjustment for that product.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatQuantity, getProduct, type Product } from '@/api/products'
import {
  FILTER_REASONS,
  formatChange,
  formatDateTime,
  listStockAdjustments,
  reasonLabel,
  toDbTimestamp,
  type StockAdjustment,
} from '@/api/stock'
import { currentUser } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import { addDays, parseIsoDate, toIsoDate } from '@/utils/date'
import StockAdjustmentFormModal from './StockAdjustmentFormModal.vue'

type Period = '' | 'today' | '7' | '30' | 'month' | 'custom'

const route = useRoute()
const router = useRouter()
const isAdmin = computed(() => currentUser.value?.role === 'admin')

// --- List, filters and paging ---

const items = ref<StockAdjustment[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const reasonFilter = ref('')
const directionFilter = ref<'' | 'in' | 'out'>('')
const period = ref<Period>('')
const customFrom = ref('') // YYYY-MM-DD, from <input type="date">
const customTo = ref('')
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(
  () => search.value !== '' || reasonFilter.value !== '' || directionFilter.value !== '' || period.value !== '',
)

/** The chosen period as local dates: from is inclusive, to is exclusive */
function periodRange(): { from: string | null; to: string | null } {
  const today = toIsoDate()
  switch (period.value) {
    case 'today':
      return { from: today, to: addDays(today, 1) }
    case '7':
      return { from: addDays(today, -6), to: addDays(today, 1) }
    case '30':
      return { from: addDays(today, -29), to: addDays(today, 1) }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: addDays(today, 1) }
    case 'custom':
      return { from: customFrom.value || null, to: customTo.value ? addDays(customTo.value, 1) : null }
    default:
      return { from: null, to: null }
  }
}

/** Local midnight of a YYYY-MM-DD date, as the UTC timestamp the API compares against */
const toTimestamp = (date: string | null) => (date ? toDbTimestamp(parseIsoDate(date)) : null)

const customRangeError = computed(() =>
  period.value === 'custom' && customFrom.value && customTo.value && customTo.value < customFrom.value
    ? 'The end date is before the start date.'
    : '',
)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loadError.value = ''
  if (customRangeError.value) {
    items.value = []
    total.value = 0
    loading.value = false // drops any request still in flight
    return
  }
  loading.value = true
  const range = periodRange()
  try {
    const result = await listStockAdjustments({
      search: search.value.trim(),
      reason: reasonFilter.value,
      direction: directionFilter.value,
      productId: null,
      from: toTimestamp(range.from),
      to: toTimestamp(range.to),
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return // a newer search already went out

    if (result.items.length === 0 && page.value > 1 && result.total > 0) {
      page.value = Math.ceil(result.total / pageSize.value)
      return
    }
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load adjustments'
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
watch([reasonFilter, directionFilter, period, customFrom, customTo, pageSize], resetToFirstPage)
watch(page, load)
load()

function clearFilters() {
  search.value = ''
  reasonFilter.value = ''
  directionFilter.value = ''
  period.value = ''
  customFrom.value = ''
  customTo.value = ''
}

// --- New adjustment ---

const formOpen = ref(false)
const formProduct = ref<Product | null>(null)
const openError = ref('')

function openForm(product: Product | null) {
  formProduct.value = product
  formOpen.value = true
}

function onSaved() {
  formOpen.value = false
  resetToFirstPage() // the new adjustment is at the top of page 1
}

// ?product=<id> opens the form for that product, then drops the param so a refresh doesn't reopen it
watch(
  () => route.query.product,
  async (value) => {
    const id = Number(value)
    if (!value || !Number.isSafeInteger(id) || id <= 0) return
    router.replace({ query: { ...route.query, product: undefined } })
    if (!isAdmin.value) return
    openError.value = ''
    try {
      openForm(await getProduct(id))
    } catch (e) {
      openError.value = e instanceof Error ? e.message : 'Could not load the product'
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Stock Adjustment</h4>
      <h6>Every change to your stock, newest first</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="isAdmin" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>New Adjustment
      </button>
    </div>
  </div>

  <div v-if="openError" class="alert alert-danger py-2" role="alert">{{ openError }}</div>

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
              placeholder="Search product, SKU, reference or note"
              aria-label="Search adjustments"
            />
          </div>
        </div>
        <div class="filters d-flex flex-wrap gap-2">
          <select v-model="directionFilter" class="form-select" aria-label="Filter by direction">
            <option value="">Stock in &amp; out</option>
            <option value="in">Stock in</option>
            <option value="out">Stock out</option>
          </select>
          <select v-model="reasonFilter" class="form-select" aria-label="Filter by reason">
            <option value="">All reasons</option>
            <option v-for="r in FILTER_REASONS" :key="r" :value="r">{{ reasonLabel(r) }}</option>
          </select>
          <select v-model="period" class="form-select" aria-label="Filter by date">
            <option value="">All time</option>
            <option value="today">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="month">This month</option>
            <option value="custom">Custom range</option>
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
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Reason</th>
              <th class="text-end">Change</th>
              <th class="text-end">Stock</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in items" :key="entry.id">
              <td>
                <div>{{ formatDateTime(entry.createdAt) }}</div>
                <div class="fs-12 text-gray-5 entry-meta" :title="`${entry.reference} · ${entry.userName}`">
                  {{ entry.reference }} · {{ entry.userName }}
                </div>
              </td>
              <td>
                <div class="d-flex align-items-center gap-2">
                  <span class="product-image">
                    <img v-if="entry.product.imageUrl" :src="entry.product.imageUrl" :alt="entry.product.name" loading="lazy" />
                    <i v-else class="ti ti-box"></i>
                  </span>
                  <div class="min-w-0">
                    <div class="fw-medium text-gray-9 product-name">{{ entry.product.name }}</div>
                    <div class="fs-12 text-gray-5">
                      {{ entry.product.sku }}<template v-if="entry.product.id === null"> · deleted</template>
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <div>{{ reasonLabel(entry.reason) }}</div>
                <div v-if="entry.note" class="fs-12 text-gray-5 note" :title="entry.note">{{ entry.note }}</div>
              </td>
              <td class="text-end fw-semibold" :class="entry.quantityChange > 0 ? 'text-success' : 'text-danger'">
                {{ formatChange(entry.quantityChange) }} {{ entry.unitShortName }}
              </td>
              <td class="text-end text-gray-5">
                {{ formatQuantity(entry.quantityBefore) }} → <span class="text-gray-9">{{ formatQuantity(entry.quantityAfter) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones, tablets and small laptops) -->
      <div class="d-xl-none entry-cards" :class="{ 'is-loading': loading }">
        <div v-for="entry in items" :key="entry.id" class="entry-card">
          <div class="d-flex gap-3">
            <span class="product-image">
              <img v-if="entry.product.imageUrl" :src="entry.product.imageUrl" :alt="entry.product.name" loading="lazy" />
              <i v-else class="ti ti-box"></i>
            </span>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="fw-medium text-gray-9 text-break">{{ entry.product.name }}</div>
                <div
                  class="fw-semibold text-nowrap"
                  :class="entry.quantityChange > 0 ? 'text-success' : 'text-danger'"
                >
                  {{ formatChange(entry.quantityChange) }} {{ entry.unitShortName }}
                </div>
              </div>
              <div class="d-flex justify-content-between align-items-start gap-2 fs-12 text-gray-5">
                <span class="text-break">
                  {{ entry.product.sku }}<template v-if="entry.product.id === null"> · deleted</template>
                </span>
                <span class="text-nowrap">
                  {{ formatQuantity(entry.quantityBefore) }} → {{ formatQuantity(entry.quantityAfter) }}
                </span>
              </div>
              <div class="fs-13 mt-1">{{ reasonLabel(entry.reason) }}</div>
              <div v-if="entry.note" class="fs-13 text-gray-5 text-break">{{ entry.note }}</div>
              <div class="fs-12 text-gray-5 mt-1">
                {{ entry.reference }} · {{ formatDateTime(entry.createdAt) }} · {{ entry.userName }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-stairs-up fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">
          No adjustments match your filters.
          <button type="button" class="btn btn-link btn-sm p-0 align-baseline" @click="clearFilters">Clear filters</button>
        </template>
        <template v-else>No stock adjustments yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Adjustment pages" />
  </div>

  <StockAdjustmentFormModal v-if="formOpen" :product="formProduct" @close="formOpen = false" @saved="onSaved" />
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

.entry-meta {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.product-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.product-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 18px;
  overflow: hidden;
}

.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.entry-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.entry-card:last-child {
  border-bottom: 0;
}

/* Tablets: two cards per row */
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
