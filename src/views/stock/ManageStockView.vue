<script setup lang="ts">
// Stock on hand for every product, with quick adjust and history.
import { computed, ref, watch } from 'vue'
import {
  formatPeso,
  formatQuantity,
  getProductOptions,
  listProducts,
  type Product,
  type ProductOptions,
  type ProductStatus,
} from '@/api/products'
import { getStockSummary, type StockSummary } from '@/api/stock'
import { can } from '@/auth'
import ListPager from '@/components/ListPager.vue'
import StockAdjustmentFormModal from './StockAdjustmentFormModal.vue'
import StockHistoryModal from './StockHistoryModal.vue'

type StockLevel = 'out' | 'low' | 'ok'

const canAdjust = computed(() => can('stock.adjust'))
const showCost = computed(() => can('products.manage')) // the API leaves costs out otherwise

// --- Summary ---

const summary = ref<StockSummary | null>(null)

function loadSummary() {
  getStockSummary()
    .then((result) => (summary.value = result))
    .catch(() => {}) // the list still works without the summary cards
}

// --- List, filters and paging ---

const items = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<ProductStatus | ''>('active')
const stockFilter = ref<'' | 'low' | 'out'>('')
const categoryFilter = ref<number | null>(null)
const brandFilter = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(
  () =>
    search.value !== '' ||
    statusFilter.value !== '' ||
    stockFilter.value !== '' ||
    categoryFilter.value !== null ||
    brandFilter.value !== null,
)

const options = ref<ProductOptions>({ categories: [], subcategories: [], brands: [], units: [], warranties: [] })
getProductOptions()
  .then((result) => (options.value = result))
  .catch(() => {})

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listProducts({
      search: search.value.trim(),
      status: statusFilter.value,
      categoryId: categoryFilter.value,
      subcategoryId: null,
      brandId: brandFilter.value,
      stock: stockFilter.value || undefined,
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
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load products'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function refresh() {
  load()
  loadSummary()
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
watch([statusFilter, stockFilter, categoryFilter, brandFilter, pageSize], resetToFirstPage)
watch(page, load)
refresh()

function showStockLevel(level: '' | 'low' | 'out') {
  statusFilter.value = 'active' // the summary counts active products only
  stockFilter.value = level
}

function stockLevel(product: Product): StockLevel {
  if (product.quantity <= 0) return 'out'
  if (product.quantity <= product.alertQuantity) return 'low'
  return 'ok'
}

const LEVEL_LABELS: Record<StockLevel, string> = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' }

/** Cost of the stock on hand, or null without a cost price (only shown with products.manage) */
function stockValue(product: Product): number | null {
  if (product.costCents === null) return null
  return product.quantity > 0 ? Math.round(product.quantity * product.costCents) : 0
}

// --- Dialogs ---

const adjusting = ref<Product | null>(null)
const adjustOpen = ref(false)
const historyOf = ref<Product | null>(null)

function openAdjust(product: Product | null) {
  adjusting.value = product
  adjustOpen.value = true
}

function onAdjusted() {
  adjustOpen.value = false
  refresh()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Manage Stock</h4>
      <h6>Stock on hand for every product</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="refresh">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="canAdjust" type="button" class="btn btn-primary" @click="openAdjust(null)">
        <i class="ti ti-adjustments-horizontal me-1"></i>Adjust Stock
      </button>
    </div>
  </div>

  <!-- Summary -->
  <div class="summary-grid mb-3">
    <button type="button" class="summary-card" @click="showStockLevel('')">
      <span class="summary-icon bg-primary-soft"><i class="ti ti-box"></i></span>
      <span class="min-w-0">
        <span class="summary-label">Active Products</span>
        <span class="summary-value">{{ summary ? summary.productCount.toLocaleString() : '—' }}</span>
      </span>
    </button>
    <div class="summary-card">
      <span class="summary-icon bg-success-soft"><i class="ti ti-currency-peso"></i></span>
      <span class="min-w-0">
        <span class="summary-label">{{ showCost ? 'Stock Value (Cost)' : 'Stock Value (Retail)' }}</span>
        <span class="summary-value text-truncate">
          <template v-if="!summary">—</template>
          <template v-else-if="showCost && summary.costValueCents !== null">{{ formatPeso(summary.costValueCents) }}</template>
          <template v-else>{{ formatPeso(summary.retailValueCents) }}</template>
        </span>
        <span v-if="showCost && summary" class="summary-hint text-truncate">
          Retail {{ formatPeso(summary.retailValueCents) }}
          <template v-if="summary.missingCostCount">· {{ summary.missingCostCount }} without cost</template>
        </span>
      </span>
    </div>
    <button type="button" class="summary-card" @click="showStockLevel('low')">
      <span class="summary-icon bg-warning-soft"><i class="ti ti-trending-down"></i></span>
      <span class="min-w-0">
        <span class="summary-label">Low Stock</span>
        <span class="summary-value">{{ summary ? summary.lowCount.toLocaleString() : '—' }}</span>
      </span>
    </button>
    <button type="button" class="summary-card" @click="showStockLevel('out')">
      <span class="summary-icon bg-danger-soft"><i class="ti ti-package-off"></i></span>
      <span class="min-w-0">
        <span class="summary-label">Out of Stock</span>
        <span class="summary-value">{{ summary ? summary.outCount.toLocaleString() : '—' }}</span>
      </span>
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
        <select v-model="stockFilter" class="form-select" aria-label="Filter by stock level">
          <option value="">All stock levels</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <select v-model="categoryFilter" class="form-select" aria-label="Filter by category">
          <option :value="null">All categories</option>
          <option v-for="c in options.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <select v-model="brandFilter" class="form-select" aria-label="Filter by brand">
          <option :value="null">All brands</option>
          <option v-for="b in options.brands" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (wide screens) -->
      <div class="table-responsive d-none d-xl-block">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th class="text-end">In Stock</th>
              <th class="text-end">Alert At</th>
              <th v-if="showCost" class="text-end">Stock Value</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
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
              <td class="text-end">
                <div class="fw-medium" :class="`level-${stockLevel(product)}`">
                  {{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}
                </div>
                <div v-if="stockLevel(product) !== 'ok'" class="fs-12" :class="`level-${stockLevel(product)}`">
                  {{ LEVEL_LABELS[stockLevel(product)] }}
                </div>
              </td>
              <td class="text-end">{{ formatQuantity(product.alertQuantity) }} {{ product.unit.shortName }}</td>
              <td v-if="showCost" class="text-end">
                <template v-if="stockValue(product) === null"><span class="text-gray-5">No cost</span></template>
                <template v-else>{{ formatPeso(stockValue(product)!) }}</template>
              </td>
              <td>
                <span class="badge" :class="product.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ product.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td class="text-end">
                <div class="row-actions">
                  <button type="button" title="Stock history" @click="historyOf = product">
                    <i class="ti ti-history"></i>
                  </button>
                  <button v-if="canAdjust" type="button" title="Adjust stock" @click="openAdjust(product)">
                    <i class="ti ti-adjustments-horizontal"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones, tablets and small laptops) -->
      <div class="d-xl-none product-cards" :class="{ 'is-loading': loading }">
        <div v-for="product in items" :key="product.id" class="product-card">
          <div class="d-flex gap-3">
            <span class="product-image product-image-lg">
              <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" loading="lazy" />
              <i v-else class="ti ti-box"></i>
            </span>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="fw-medium text-gray-9 text-break">{{ product.name }}</div>
                <span
                  v-if="product.status === 'inactive'"
                  class="badge bg-danger flex-shrink-0"
                >Inactive</span>
              </div>
              <div class="fs-12 text-gray-5 text-break">
                {{ product.sku }}<template v-if="product.category"> · {{ product.category.name }}</template>
              </div>
              <div class="d-flex flex-wrap align-items-center gap-2 mt-1 fs-13">
                <span class="fw-medium" :class="`level-${stockLevel(product)}`">
                  {{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}
                </span>
                <span v-if="stockLevel(product) !== 'ok'" class="fs-12" :class="`level-${stockLevel(product)}`">
                  {{ LEVEL_LABELS[stockLevel(product)] }}
                </span>
                <span class="fs-12 text-gray-5">
                  alert at {{ formatQuantity(product.alertQuantity) }} {{ product.unit.shortName }}
                </span>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-between align-items-center gap-3 mt-2">
            <span class="fs-12 text-gray-5 min-w-0 text-truncate">
              <template v-if="showCost">
                Value:
                <template v-if="stockValue(product) === null">no cost price</template>
                <template v-else>{{ formatPeso(stockValue(product)!) }}</template>
              </template>
            </span>
            <div class="row-actions flex-shrink-0">
              <button type="button" title="Stock history" @click="historyOf = product">
                <i class="ti ti-history"></i>
              </button>
              <button v-if="canAdjust" type="button" title="Adjust stock" @click="openAdjust(product)">
                <i class="ti ti-adjustments-horizontal"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-stack-3 fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">No products match your filters.</template>
        <template v-else>No products yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Stock pages" />
  </div>

  <StockAdjustmentFormModal v-if="adjustOpen" :product="adjusting" @close="adjustOpen = false" @saved="onAdjusted" />
  <StockHistoryModal v-if="historyOf" :product="historyOf" @close="historyOf = null" />
</template>

<style scoped>
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  text-align: start;
}

button.summary-card:hover {
  border-color: #fe9f43;
}

.summary-card > .min-w-0 {
  display: flex;
  flex-direction: column;
}

.summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  font-size: 20px;
}

.bg-primary-soft {
  background: #fff6ee;
  color: #fe9f43;
}

.bg-success-soft {
  background: #eafaf3;
  color: #3eb780;
}

.bg-warning-soft {
  background: #fff8e6;
  color: #e69500;
}

.bg-danger-soft {
  background: #ffeeec;
  color: #ff0000;
}

.summary-label {
  color: #646b72;
  font-size: 13px;
}

.summary-value {
  color: #212b36;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.summary-hint {
  color: #a6aaaf;
  font-size: 11px;
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
  min-width: 140px;
  max-width: 190px;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.product-name {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.level-low {
  color: #e69500;
}

.level-out {
  color: #ff0000;
}

.badge {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  font-size: 11px;
}

.row-actions {
  display: inline-flex;
  gap: 8px;
}

.row-actions button {
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

.row-actions button:hover {
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

@media (max-width: 1199.98px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
}

@media (max-width: 575.98px) {
  .summary-grid {
    gap: 8px;
  }

  .summary-card {
    padding: 12px;
    gap: 10px;
  }

  .summary-icon {
    width: 36px;
    height: 36px;
    font-size: 18px;
  }

  .summary-value {
    font-size: 16px;
  }

  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
