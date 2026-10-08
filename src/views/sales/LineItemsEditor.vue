<script setup lang="ts">
// Product lines on a sale or quotation form: search (or scan a barcode) to add a product,
// then set each line's quantity and, when allowed, its price. One layout serves every
// screen size: a table row on wide screens, a stacked card on phones.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatQuantity, listProducts, type Product } from '@/api/products'
import { isOverStock, lineCents, lineFromProduct, lineQuantity, type EditorLine } from './lines'
import { currencySymbol, formatMoney } from '@/utils/money'

const props = defineProps<{
  canEditPrice: boolean
  checkStock: boolean // warn when a line needs more than is in stock (sales)
}>()
const lines = defineModel<EditorLine[]>({ required: true })

const MAX_LINES = 200

// --- Product search ---

const search = ref('')
const results = ref<Product[]>([])
const searching = ref(false)
const searchError = ref('')
const searchFocused = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
let latestSearch = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch(): Promise<Product[]> {
  const requestId = ++latestSearch
  const text = search.value.trim()
  if (!text) {
    results.value = []
    searching.value = false
    return []
  }
  searching.value = true
  searchError.value = ''
  try {
    const result = await listProducts({
      search: text,
      status: 'active',
      categoryId: null,
      subcategoryId: null,
      brandId: null,
      page: 1,
      pageSize: 8,
    })
    if (requestId === latestSearch) results.value = result.items
    return result.items
  } catch (e) {
    if (requestId === latestSearch) searchError.value = e instanceof Error ? e.message : 'Search failed'
    return []
  } finally {
    if (requestId === latestSearch) searching.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const showResults = computed(() => searchFocused.value && search.value.trim() !== '')
const addError = ref('')

function add(product: Product) {
  addError.value = ''
  const existing = lines.value.find((line) => line.productId === product.id)
  if (existing) {
    const quantity = lineQuantity(existing) ?? 0
    existing.quantityText = String(Math.round((quantity + 1) * 1000) / 1000)
  } else if (lines.value.length >= MAX_LINES) {
    addError.value = `A document can have up to ${MAX_LINES} products.`
    return
  } else {
    lines.value.push(lineFromProduct(product))
  }
  search.value = ''
  results.value = []
  searchInput.value?.focus()
}

/** Enter adds the product whose barcode or SKU matches exactly (what a scanner types), or the only result */
async function addFromEnter() {
  clearTimeout(searchTimer)
  const text = search.value.trim().toLowerCase()
  if (!text) return
  const found = await runSearch()
  const exact = found.find((p) => p.barcode?.toLowerCase() === text || p.sku.toLowerCase() === text)
  const pick = exact ?? (found.length === 1 ? found[0] : undefined)
  if (pick) add(pick)
}

function remove(index: number) {
  lines.value.splice(index, 1)
}
</script>

<template>
  <div>
    <!-- Search -->
    <div class="product-search mb-3">
      <div class="search-input">
        <span class="search-icon"><i class="ti ti-search"></i></span>
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          class="form-control"
          placeholder="Search or scan product name, SKU or barcode"
          aria-label="Add a product"
          autocomplete="off"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keydown.enter.prevent="addFromEnter"
        />
      </div>
      <div v-if="showResults" class="search-results" :class="{ 'is-loading': searching }">
        <div v-if="searchError" class="text-danger fs-13 p-2">{{ searchError }}</div>
        <button
          v-for="item in results"
          :key="item.id"
          type="button"
          class="search-result"
          @mousedown.prevent="add(item)"
        >
          <span class="product-image product-image-sm">
            <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" loading="lazy" />
            <i v-else class="ti ti-box"></i>
          </span>
          <span class="flex-grow-1 min-w-0 text-start">
            <span class="d-block fw-medium text-gray-9 text-truncate">{{ item.name }}</span>
            <span class="d-block fs-12 text-gray-5 text-truncate">
              {{ item.sku }} · {{ formatQuantity(item.quantity) }} {{ item.unit.shortName }} in stock
            </span>
          </span>
          <span class="fs-13 fw-medium text-nowrap">{{ formatMoney(item.priceCents) }}</span>
        </button>
        <div v-if="!searching && !searchError && results.length === 0" class="text-gray-5 fs-13 p-2 text-center">
          No products found.
        </div>
      </div>
      <div v-if="addError" class="text-danger fs-13 mt-1">{{ addError }}</div>
    </div>

    <!-- Lines -->
    <div class="lines">
      <div v-if="lines.length > 0" class="line line-head d-none d-md-grid">
        <span>Product</span>
        <span>Unit Price</span>
        <span>Quantity</span>
        <span class="text-end">Total</span>
        <span></span>
      </div>
      <div v-for="(line, index) in lines" :key="line.productId" class="line">
        <div class="line-product">
          <span class="product-image">
            <img v-if="line.imageUrl" :src="line.imageUrl" :alt="line.name" loading="lazy" />
            <i v-else class="ti ti-box"></i>
          </span>
          <div class="min-w-0">
            <div class="fw-medium text-gray-9 text-break">{{ line.name }}</div>
            <div class="fs-12 text-gray-5 text-break">
              {{ line.sku }}
              <template v-if="checkStock && line.stock !== null">
                · {{ formatQuantity(line.stock) }} {{ line.unitShortName }} in stock
              </template>
            </div>
            <div v-if="checkStock && isOverStock(line)" class="fs-12 text-danger">More than in stock</div>
          </div>
          <button type="button" class="btn-remove d-md-none" :title="`Remove ${line.name}`" @click="remove(index)">
            <i class="ti ti-x"></i>
          </button>
        </div>

        <div class="line-price">
          <label class="line-label d-md-none" :for="`line-price-${line.productId}`">Unit price</label>
          <div v-if="props.canEditPrice" class="input-group input-group-sm">
            <span class="input-group-text">{{ currencySymbol() }}</span>
            <input
              :id="`line-price-${line.productId}`"
              v-model="line.priceText"
              type="text"
              class="form-control"
              inputmode="decimal"
              :aria-label="`Price of ${line.name}`"
            />
          </div>
          <div v-else class="price-text">{{ line.priceText ? `${currencySymbol()}${line.priceText}` : '—' }}</div>
        </div>

        <div class="line-quantity">
          <label class="line-label d-md-none" :for="`line-qty-${line.productId}`">Quantity</label>
          <div class="input-group input-group-sm">
            <input
              :id="`line-qty-${line.productId}`"
              v-model="line.quantityText"
              type="number"
              class="form-control"
              min="0"
              :step="line.allowDecimal ? '0.001' : '1'"
              :inputmode="line.allowDecimal ? 'decimal' : 'numeric'"
              :class="{ 'is-invalid': line.quantityText !== '' && lineQuantity(line) === null }"
              :aria-label="`Quantity of ${line.name}`"
            />
            <span class="input-group-text">{{ line.unitShortName }}</span>
          </div>
        </div>

        <div class="line-total">
          <span class="line-label d-md-none">Total</span>
          <span class="fw-semibold text-gray-9">{{ formatMoney(lineCents(line)) }}</span>
        </div>

        <div class="line-remove d-none d-md-flex justify-content-end">
          <button type="button" class="btn-remove" :title="`Remove ${line.name}`" @click="remove(index)">
            <i class="ti ti-x"></i>
          </button>
        </div>
      </div>

      <div v-if="lines.length === 0" class="text-center text-gray-5 py-4 empty-lines">
        <i class="ti ti-shopping-cart fs-24 d-block mb-2"></i>
        Search for products above to add them.
      </div>
    </div>
  </div>
</template>

<style scoped>
.product-search {
  position: relative;
}

.search-input {
  position: relative;
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
}

.search-results {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 300px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
  overflow-y: auto;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid #f2f4f7;
  background: #ffffff;
}

.search-result:last-child {
  border-bottom: 0;
}

.search-result:hover {
  background: #fff6ee;
}

.lines {
  border: 1px solid #e6eaed;
  border-radius: 8px;
}

.line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1fr;
  grid-template-areas:
    'product product'
    'price quantity'
    'total total';
  gap: 8px 12px;
  padding: 12px;
  border-bottom: 1px solid #e6eaed;
}

.line:last-child {
  border-bottom: 0;
}

.line-product {
  grid-area: product;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.line-price {
  grid-area: price;
}

.line-quantity {
  grid-area: quantity;
}

.line-total {
  grid-area: total;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.line-label {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  color: #646b72;
}

.line-total .line-label {
  margin: 0;
}

.price-text {
  padding: 4px 0;
  font-weight: 500;
}

/* Wide screens: one row per line, under a header */
@media (min-width: 768px) {
  .line {
    grid-template-columns: minmax(0, 1fr) 130px 150px 110px 32px;
    grid-template-areas: 'product price quantity total remove';
    align-items: center;
  }

  .line-head {
    padding-top: 10px;
    padding-bottom: 10px;
    background: #f9fafb;
    border-radius: 8px 8px 0 0;
    color: #212b36;
    font-size: 13px;
    font-weight: 600;
  }

  .line-total {
    justify-content: flex-end;
  }

  .line-remove {
    grid-area: remove;
  }
}

.btn-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  margin-left: auto;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #ff0000;
}

.btn-remove:hover {
  background: #ffeeec;
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

.product-image-sm {
  width: 32px;
  height: 32px;
  font-size: 15px;
}

.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.6;
}
</style>
