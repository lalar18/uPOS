<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  deleteProduct,
  formatQuantity,
  getProductOptions,
  listProducts,
  type Product,
  type ProductOptions,
  type ProductStatus,
} from '@/api/products'
import { can } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import ListPager from '@/components/ListPager.vue'
import { formatMoney } from '@/utils/money'

const canEdit = computed(() => can('products.manage'))

// --- List, filters and paging ---

const items = ref<Product[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<ProductStatus | ''>('')
const categoryFilter = ref<number | null>(null)
const brandFilter = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(
  () => search.value !== '' || statusFilter.value !== '' || categoryFilter.value !== null || brandFilter.value !== null,
)

// Category and brand choices for the filters. The list still works if these fail to load.
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
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return // a newer search already went out

    // Deleting the last row on a page leaves it empty; step back a page
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

function resetToFirstPage() {
  if (page.value === 1) load()
  else page.value = 1 // the page watcher reloads
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(resetToFirstPage, 300)
})
watch([statusFilter, categoryFilter, brandFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

type StockLevel = 'out' | 'low' | 'ok'

function stockLevel(product: Product): StockLevel {
  if (product.quantity <= 0) return 'out'
  if (product.quantity <= product.alertQuantity) return 'low'
  return 'ok'
}

const STOCK_LABELS: Record<StockLevel, string> = { out: 'Out of stock', low: 'Low stock', ok: '' }

// --- Dialogs ---

const deleting = ref<Product | null>(null)

function onDeleted() {
  deleting.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Products</h4>
      <h6>Manage your products</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <RouterLink v-if="canEdit" :to="{ name: 'product-create' }" class="btn btn-primary">
        <i class="ti ti-circle-plus me-1"></i>Add Product
      </RouterLink>
    </div>
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
        <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
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
              <th class="text-end">Price</th>
              <th class="text-end">Stock</th>
              <th>Status</th>
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
              <td>
                <div>{{ product.category?.name ?? '—' }}</div>
                <div v-if="product.subcategory" class="fs-12 text-gray-5">{{ product.subcategory.name }}</div>
              </td>
              <td>{{ product.brand?.name ?? '—' }}</td>
              <td class="text-end fw-medium text-gray-9">{{ formatMoney(product.priceCents) }}</td>
              <td class="text-end">
                <div>{{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}</div>
                <div v-if="stockLevel(product) !== 'ok'" class="fs-12" :class="`stock-${stockLevel(product)}`">
                  {{ STOCK_LABELS[stockLevel(product)] }}
                </div>
              </td>
              <td>
                <span class="badge" :class="product.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ product.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="canEdit" class="text-end">
                <div class="row-actions">
                  <RouterLink :to="{ name: 'product-edit', params: { id: product.id } }" title="Edit">
                    <i class="ti ti-edit"></i>
                  </RouterLink>
                  <button type="button" title="Delete" @click="deleting = product"><i class="ti ti-trash"></i></button>
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
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="fw-medium text-gray-9 text-break min-w-0">{{ product.name }}</div>
                <div class="fw-semibold text-gray-9 text-nowrap">{{ formatMoney(product.priceCents) }}</div>
              </div>
              <div class="fs-12 text-gray-5 text-break">
                {{ product.sku }}
                <template v-if="product.category"> · {{ product.category.name }}</template>
                <template v-if="product.subcategory"> › {{ product.subcategory.name }}</template>
                <template v-if="product.brand"> · {{ product.brand.name }}</template>
              </div>
              <div class="d-flex flex-wrap align-items-center gap-2 mt-1 fs-13">
                <span>{{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}</span>
                <span v-if="stockLevel(product) !== 'ok'" class="fs-12" :class="`stock-${stockLevel(product)}`">
                  {{ STOCK_LABELS[stockLevel(product)] }}
                </span>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="badge" :class="product.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ product.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
            <div v-if="canEdit" class="row-actions">
              <RouterLink :to="{ name: 'product-edit', params: { id: product.id } }" title="Edit">
                <i class="ti ti-edit"></i>
              </RouterLink>
              <button type="button" title="Delete" @click="deleting = product"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-box fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">No products match your filters.</template>
        <template v-else>
          No products yet.
          <RouterLink v-if="canEdit" :to="{ name: 'product-create' }" class="d-block mt-2">Add your first product</RouterLink>
        </template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Product pages" />
  </div>

  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Product"
    :item-name="deleting.name"
    :action="() => deleteProduct(deleting!.id)"
    @close="deleting = null"
    @deleted="onDeleted"
  />
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
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  font-size: 11px;
}

.stock-low {
  color: #e69500;
}

.stock-out {
  color: #ff0000;
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

/* Phones: search on its own row, filters share the next one */
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
  .filters .form-select:last-child {
    flex-basis: 100%;
  }

  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
