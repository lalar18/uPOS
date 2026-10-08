<script setup lang="ts">
// Products at or below their low stock alert, and products that have run out.
import { computed, ref, watch } from 'vue'
import { formatQuantity, getProductOptions, listProducts, type Product, type ProductOptions } from '@/api/products'
import { can } from '@/auth'
import ListPager from '@/components/ListPager.vue'

type Tab = 'low' | 'out'

const canEdit = computed(() => can('products.manage'))

// --- List, filters and paging ---

const tab = ref<Tab>('low')
const items = ref<Product[]>([])
const total = ref(0)
const counts = ref<Record<Tab, number | null>>({ low: null, out: null })
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const categoryFilter = ref<number | null>(null)
const brandFilter = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(() => search.value !== '' || categoryFilter.value !== null || brandFilter.value !== null)

const options = ref<ProductOptions>({ categories: [], subcategories: [], brands: [], units: [], warranties: [] })
getProductOptions()
  .then((result) => (options.value = result))
  .catch(() => {})

function query(stock: Tab, pageNumber: number, size: number) {
  return {
    search: search.value.trim(),
    status: 'active' as const, // inactive products aren't sold, so their stock doesn't need watching
    categoryId: categoryFilter.value,
    subcategoryId: null,
    brandId: brandFilter.value,
    stock,
    page: pageNumber,
    pageSize: size,
  }
}

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  const other: Tab = tab.value === 'low' ? 'out' : 'low'
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
watch([tab, categoryFilter, brandFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

/** How full the stock is relative to its alert level, for the little bar (0–100) */
function stockPercent(product: Product): number {
  if (product.alertQuantity <= 0) return 0
  return Math.min(Math.round((product.quantity / product.alertQuantity) * 100), 100)
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Low Stocks</h4>
      <h6>Active products that need restocking</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tab-bar mb-3" role="tablist">
    <button type="button" role="tab" :aria-selected="tab === 'low'" :class="{ active: tab === 'low' }" @click="tab = 'low'">
      <i class="ti ti-trending-down"></i>Low Stock
      <span v-if="counts.low !== null" class="count bg-warning">{{ counts.low }}</span>
    </button>
    <button type="button" role="tab" :aria-selected="tab === 'out'" :class="{ active: tab === 'out' }" @click="tab = 'out'">
      <i class="ti ti-package-off"></i>Out of Stock
      <span v-if="counts.out !== null" class="count bg-danger">{{ counts.out }}</span>
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
        <select v-model="brandFilter" class="form-select" aria-label="Filter by brand">
          <option :value="null">All brands</option>
          <option v-for="b in options.brands" :key="b.id" :value="b.id">{{ b.name }}</option>
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
              <th>Brand</th>
              <th class="text-end">In Stock</th>
              <th class="text-end">Alert At</th>
              <th v-if="canEdit" class="text-end">Actions</th>
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
                    <div class="fw-medium text-gray-9 product-name">{{ product.name }}</div>
                    <div class="fs-12 text-gray-5">{{ product.sku }}</div>
                  </div>
                </div>
              </td>
              <td>{{ product.category?.name ?? '—' }}</td>
              <td>{{ product.brand?.name ?? '—' }}</td>
              <td class="text-end">
                <div class="fw-medium" :class="tab === 'out' ? 'text-danger' : 'stock-low'">
                  {{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}
                </div>
                <div v-if="tab === 'low'" class="stock-bar ms-auto">
                  <span :style="{ width: `${stockPercent(product)}%` }"></span>
                </div>
              </td>
              <td class="text-end">{{ formatQuantity(product.alertQuantity) }} {{ product.unit.shortName }}</td>
              <td v-if="canEdit" class="text-end">
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
              <div class="fw-medium text-gray-9 text-break">{{ product.name }}</div>
              <div class="fs-12 text-gray-5 text-break">
                {{ product.sku }}
                <template v-if="product.category"> · {{ product.category.name }}</template>
                <template v-if="product.brand"> · {{ product.brand.name }}</template>
              </div>
              <div class="d-flex flex-wrap align-items-center gap-2 mt-1 fs-13">
                <span class="fw-medium" :class="tab === 'out' ? 'text-danger' : 'stock-low'">
                  {{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}
                </span>
                <span class="text-gray-5 fs-12">
                  alert at {{ formatQuantity(product.alertQuantity) }} {{ product.unit.shortName }}
                </span>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-between align-items-center gap-3 mt-2">
            <div v-if="tab === 'low'" class="stock-bar flex-grow-1">
              <span :style="{ width: `${stockPercent(product)}%` }"></span>
            </div>
            <span v-else class="fs-12 text-danger">Out of stock</span>
            <div v-if="canEdit" class="row-actions">
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
        <template v-if="hasFilters">No products match your filters.</template>
        <template v-else-if="tab === 'low'">No products are running low.</template>
        <template v-else>No products are out of stock.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Low stock pages" />
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

.stock-low {
  color: #e69500;
}

.stock-bar {
  width: 80px;
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  background: #f2f4f7;
  overflow: hidden;
}

.stock-bar span {
  display: block;
  height: 100%;
  background: #e69500;
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
