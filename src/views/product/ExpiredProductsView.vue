<script setup lang="ts">
// Products past their expiry date, or expiring within the next few days.
import { computed, ref, watch } from 'vue'
import { formatQuantity, getProductOptions, listProducts, type Product, type ProductOptions } from '@/api/products'
import { currentUser } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import { addDays, daysBetween, formatIsoDate, toIsoDate } from '@/utils/date'

type Tab = 'expired' | 'soon'

const SOON_CHOICES = [7, 30, 60, 90]

const isAdmin = computed(() => currentUser.value?.role === 'admin')

// --- List, filters and paging ---

const tab = ref<Tab>('expired')
const soonDays = ref(30)
const items = ref<Product[]>([])
const total = ref(0)
const counts = ref<Record<Tab, number | null>>({ expired: null, soon: null })
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const categoryFilter = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)

const today = ref(toIsoDate())

const options = ref<ProductOptions>({ categories: [], subcategories: [], brands: [], units: [], warranties: [] })
getProductOptions()
  .then((result) => (options.value = result))
  .catch(() => {})

/** Expired: before today. Expiring soon: today up to (and including) today + soonDays. */
function expiryRange(which: Tab) {
  return which === 'expired'
    ? { expiresBefore: today.value }
    : { expiresFrom: today.value, expiresBefore: addDays(today.value, soonDays.value + 1) }
}

function query(which: Tab, pageNumber: number, size: number) {
  return {
    search: search.value.trim(),
    status: '' as const,
    categoryId: categoryFilter.value,
    subcategoryId: null,
    brandId: null,
    ...expiryRange(which),
    page: pageNumber,
    pageSize: size,
  }
}

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  today.value = toIsoDate() // the page may have been open past midnight
  loading.value = true
  loadError.value = ''
  const other: Tab = tab.value === 'expired' ? 'soon' : 'expired'
  try {
    const [result, otherResult] = await Promise.all([
      listProducts(query(tab.value, page.value, pageSize.value)),
      listProducts(query(other, 1, 1)), // only its total, for the tab badge
    ])
    if (requestId !== latestRequest) return // a newer search already went out

    if (result.items.length === 0 && page.value > 1 && result.total > 0) {
      page.value = Math.ceil(result.total / pageSize.value)
      return
    }
    items.value = result.items
    total.value = result.total
    counts.value = { [tab.value]: result.total, [other]: otherResult.total } as Record<Tab, number>
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load products'
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
watch([tab, soonDays, categoryFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

/** "Expired 3 days ago", "Expires today", "In 12 days" */
function expiryLabel(product: Product): string {
  const days = daysBetween(today.value, product.expiryDate!)
  if (days < 0) return `Expired ${-days} ${days === -1 ? 'day' : 'days'} ago`
  if (days === 0) return 'Expires today'
  return `In ${days} ${days === 1 ? 'day' : 'days'}`
}

const expiryClass = (product: Product) => (daysBetween(today.value, product.expiryDate!) < 0 ? 'text-danger' : 'text-warning')
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Expired Products</h4>
      <h6>Products past or near their expiry date</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tab-bar mb-3" role="tablist">
    <button
      type="button"
      role="tab"
      :aria-selected="tab === 'expired'"
      :class="{ active: tab === 'expired' }"
      @click="tab = 'expired'"
    >
      <i class="ti ti-alert-octagon"></i>Expired
      <span v-if="counts.expired !== null" class="count bg-danger">{{ counts.expired }}</span>
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="tab === 'soon'"
      :class="{ active: tab === 'soon' }"
      @click="tab = 'soon'"
    >
      <i class="ti ti-clock-exclamation"></i>Expiring Soon
      <span v-if="counts.soon !== null" class="count bg-warning">{{ counts.soon }}</span>
    </button>
  </div>

  <div class="card">
    <!-- Search and filters -->
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="search-set">
        <div class="search-input">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Search name, SKU or barcode"
            aria-label="Search products"
          />
        </div>
      </div>
      <div class="filters d-flex flex-wrap gap-2">
        <select v-model="categoryFilter" class="form-select" aria-label="Filter by category">
          <option :value="null">All categories</option>
          <option v-for="c in options.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <select v-if="tab === 'soon'" v-model.number="soonDays" class="form-select" aria-label="Expiring within">
          <option v-for="days in SOON_CHOICES" :key="days" :value="days">Within {{ days }} days</option>
        </select>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (desktops) -->
      <div class="table-responsive d-none d-lg-block">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Manufactured</th>
              <th>Expiry Date</th>
              <th class="text-end">Stock</th>
              <th v-if="isAdmin" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="product in items" :key="product.id">
              <td>
                <div class="d-flex align-items-center gap-2">
                  <span class="product-image">
                    <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" loading="lazy" />
                    <i v-else class="ti ti-box"></i>
                  </span>
                  <div class="min-w-0">
                    <div class="fw-medium text-gray-9 product-name">
                      {{ product.name }}
                      <span v-if="product.status === 'inactive'" class="badge bg-secondary ms-1">Inactive</span>
                    </div>
                    <div class="fs-12 text-gray-5">{{ product.sku }}</div>
                  </div>
                </div>
              </td>
              <td>{{ product.category?.name ?? '—' }}</td>
              <td>{{ product.manufacturedDate ? formatIsoDate(product.manufacturedDate) : '—' }}</td>
              <td>
                <div>{{ formatIsoDate(product.expiryDate!) }}</div>
                <div class="fs-12" :class="expiryClass(product)">{{ expiryLabel(product) }}</div>
              </td>
              <td class="text-end">{{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}</td>
              <td v-if="isAdmin" class="text-end">
                <div class="row-actions">
                  <RouterLink :to="{ name: 'product-edit', params: { id: product.id } }" title="Edit">
                    <i class="ti ti-edit"></i>
                  </RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones and tablets) -->
      <div class="d-lg-none product-cards" :class="{ 'is-loading': loading }">
        <div v-for="product in items" :key="product.id" class="product-card">
          <div class="d-flex gap-3">
            <span class="product-image product-image-lg">
              <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" loading="lazy" />
              <i v-else class="ti ti-box"></i>
            </span>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-medium text-gray-9 text-break">
                {{ product.name }}
                <span v-if="product.status === 'inactive'" class="badge bg-secondary ms-1">Inactive</span>
              </div>
              <div class="fs-12 text-gray-5 text-break">
                {{ product.sku }}<template v-if="product.category"> · {{ product.category.name }}</template>
              </div>
              <div class="fs-13 mt-1">
                Expiry {{ formatIsoDate(product.expiryDate!) }}
                <span class="fs-12 ms-1" :class="expiryClass(product)">{{ expiryLabel(product) }}</span>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="fs-13">Stock: {{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}</span>
            <div v-if="isAdmin" class="row-actions">
              <RouterLink :to="{ name: 'product-edit', params: { id: product.id } }" title="Edit">
                <i class="ti ti-edit"></i>
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-circle-check fs-24 d-block mb-2"></i>
        <template v-if="search || categoryFilter">No products match your filters.</template>
        <template v-else-if="tab === 'expired'">No expired products.</template>
        <template v-else>Nothing expires in the next {{ soonDays }} days.</template>
        <div class="fs-12 mt-1">Products without an expiry date are not listed here.</div>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Expired product pages" />
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.tab-bar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 14px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #646b72;
  font-weight: 500;
}

.tab-bar button.active {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

.tab-bar .count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  color: #ffffff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.tab-bar button.active .count {
  background: #ffffff !important;
  color: #fe9f43;
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
  min-width: 260px;
}

.filters .form-select {
  width: auto;
  min-width: 150px;
  max-width: 200px;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.product-name {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  font-weight: 500;
  font-size: 10px;
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

.product-image-lg {
  width: 56px;
  height: 56px;
  font-size: 22px;
}

.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.product-card:last-child {
  border-bottom: 0;
}

/* Tablets: two cards per row */
@media (min-width: 768px) {
  .product-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .product-card:nth-child(odd) {
    border-right: 1px solid #e6eaed;
  }

  .product-card:nth-last-child(2):nth-child(odd) {
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
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
  }
}

@media (max-width: 575.98px) {
  .tab-bar button {
    flex: 1;
    justify-content: center;
  }
}
</style>
