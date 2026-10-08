<script setup lang="ts">
// Print Barcode (/print-barcode) and Print QR Code (/print-qrcode).
// Pick products and how many labels of each, choose a label size, then print on
// an A4 sheet or a label printer. The print copy is teleported outside #app so the
// header and sidebar never print.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { listProducts, type Product } from '@/api/products'
import { currentUser } from '@/auth'
import { barcodeSvg, qrSvg } from '@/utils/labels'
import { formatMoney } from '@/utils/money'

const props = defineProps<{ kind: 'barcode' | 'qrcode' }>()

const MAX_COPIES = 500
const MAX_LABELS = 2000 // keeps the page responsive

interface LabelSize {
  id: string
  name: string
  width: number // mm
  height: number // mm
  scale: number // text size relative to medium
}

const SIZES: LabelSize[] = [
  { id: 'small', name: 'Small · 40 × 25 mm', width: 40, height: 25, scale: 0.8 },
  { id: 'medium', name: 'Medium · 50 × 30 mm', width: 50, height: 30, scale: 1 },
  { id: 'large', name: 'Large · 70 × 40 mm', width: 70, height: 40, scale: 1.3 },
]

const isBarcode = computed(() => props.kind === 'barcode')
const title = computed(() => (isBarcode.value ? 'Print Barcode' : 'Print QR Code'))
const storeName = computed(() => currentUser.value?.store.name ?? '')

// --- Product search ---

const search = ref('')
const results = ref<Product[]>([])
const searching = ref(false)
const searchError = ref('')
const searchFocused = ref(false)
let latestSearch = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch() {
  const requestId = ++latestSearch
  const text = search.value.trim()
  if (!text) {
    results.value = []
    searching.value = false
    return
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
  } catch (e) {
    if (requestId === latestSearch) searchError.value = e instanceof Error ? e.message : 'Search failed'
  } finally {
    if (requestId === latestSearch) searching.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})

const showResults = computed(() => searchFocused.value && search.value.trim() !== '')

// --- Selected products ---

interface Selected {
  product: Product
  copies: number
}

const selected = ref<Selected[]>([])

function addProduct(product: Product) {
  const existing = selected.value.find((s) => s.product.id === product.id)
  if (existing) existing.copies = Math.min(existing.copies + 1, MAX_COPIES)
  else selected.value.push({ product, copies: 1 })
  search.value = ''
  results.value = []
}

/** Scanning a barcode into the search box and pressing Enter adds the exact match straight away */
async function onSearchEnter() {
  clearTimeout(searchTimer)
  await runSearch()
  const text = search.value.trim().toLowerCase()
  const exact = results.value.find((p) => p.barcode?.toLowerCase() === text || p.sku.toLowerCase() === text)
  const pick = exact ?? (results.value.length === 1 ? results.value[0] : undefined)
  if (pick) addProduct(pick)
}

function removeSelected(index: number) {
  selected.value.splice(index, 1)
}

function setCopies(item: Selected, value: number) {
  item.copies = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), MAX_COPIES) : 1
}

// --- Settings ---

const settings = reactive({
  sizeId: 'medium',
  paper: 'a4' as 'a4' | 'roll', // roll: label printer, one label per page
  qrContent: 'sku' as 'sku' | 'barcode', // QR codes only
  showStore: true,
  showName: true,
  showPrice: true,
})

const size = computed(() => SIZES.find((s) => s.id === settings.sizeId) ?? SIZES[1]!)

/** What a product's code encodes: its barcode when it has one (barcodes) or when chosen (QR), else its SKU */
function codeValue(product: Product): string {
  if (isBarcode.value || settings.qrContent === 'barcode') return product.barcode || product.sku
  return product.sku
}

// --- Code images (SVG markup, cached by value) ---

const svgs = ref<Record<string, string>>({})
const failed = ref<Record<string, string>>({}) // value -> why it couldn't be drawn

watchEffect(async () => {
  const values = [...new Set(selected.value.map((s) => codeValue(s.product)))]
  for (const value of values) {
    if (svgs.value[value] || failed.value[value]) continue
    try {
      svgs.value[value] = isBarcode.value ? barcodeSvg(value) : await qrSvg(value)
    } catch {
      failed.value[value] = isBarcode.value ? 'This code cannot be shown as a barcode' : 'Could not make a QR code'
    }
  }
})

// --- Labels ---

const totalLabels = computed(() => selected.value.reduce((sum, s) => sum + s.copies, 0))
const tooMany = computed(() => totalLabels.value > MAX_LABELS)

/** One entry per printed label */
const labels = computed(() => {
  if (tooMany.value) return []
  return selected.value.flatMap((s) => {
    const value = codeValue(s.product)
    return Array.from({ length: s.copies }, (_, i) => ({ key: `${s.product.id}-${i}`, product: s.product, value }))
  })
})

const ready = computed(() =>
  selected.value.every((s) => {
    const value = codeValue(s.product)
    return svgs.value[value] !== undefined || failed.value[value] !== undefined
  }),
)

const labelStyle = computed(() => ({
  width: `${size.value.width}mm`,
  height: `${size.value.height}mm`,
  '--label-scale': size.value.scale,
}))

// --- Printing ---

// The page size has to be set with an @page rule, which can't be scoped to a component
const pageStyle = document.createElement('style')

watchEffect(() => {
  pageStyle.textContent =
    settings.paper === 'roll'
      ? `@page { size: ${size.value.width}mm ${size.value.height}mm; margin: 0; }`
      : '@page { size: A4; margin: 8mm; }'
})

onMounted(() => {
  document.head.appendChild(pageStyle)
  document.body.classList.add('label-print-page')
})

onBeforeUnmount(() => {
  pageStyle.remove()
  document.body.classList.remove('label-print-page')
  clearTimeout(searchTimer)
})

function print() {
  window.print()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ title }}</h4>
      <h6>{{ isBarcode ? 'Print barcode labels for your products' : 'Print QR code labels for your products' }}</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-primary" :disabled="labels.length === 0 || !ready" @click="print">
        <i class="ti ti-printer me-1"></i>Print {{ totalLabels > 0 && !tooMany ? `(${totalLabels})` : '' }}
      </button>
    </div>
  </div>

  <div class="row g-3">
    <div class="col-lg-7">
      <!-- Products -->
      <div class="card mb-0 h-100">
        <div class="card-header">
          <h5 class="card-title mb-0"><i class="ti ti-box me-1 text-primary"></i>Products</h5>
        </div>
        <div class="card-body">
          <div class="product-search mb-3">
            <span class="search-icon"><i class="ti ti-search"></i></span>
            <input
              v-model="search"
              type="search"
              class="form-control"
              placeholder="Search or scan name, SKU or barcode"
              aria-label="Search products to add"
              autocomplete="off"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
              @keydown.enter.prevent="onSearchEnter"
            />
            <div v-if="showResults" class="search-results" role="listbox">
              <div v-if="searchError" class="px-3 py-2 text-danger fs-13">{{ searchError }}</div>
              <div v-else-if="searching && results.length === 0" class="px-3 py-2 text-gray-5 fs-13">Searching…</div>
              <div v-else-if="results.length === 0" class="px-3 py-2 text-gray-5 fs-13">No active products found.</div>
              <!-- mousedown.prevent keeps the input focused so the click lands -->
              <button
                v-for="product in results"
                :key="product.id"
                type="button"
                role="option"
                class="search-result"
                @mousedown.prevent
                @click="addProduct(product)"
              >
                <span class="product-image">
                  <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" loading="lazy" />
                  <i v-else class="ti ti-box"></i>
                </span>
                <span class="min-w-0 flex-grow-1 text-start">
                  <span class="d-block fw-medium text-gray-9 text-truncate">{{ product.name }}</span>
                  <span class="d-block fs-12 text-gray-5 text-truncate">
                    {{ product.sku }}<template v-if="product.barcode"> · {{ product.barcode }}</template>
                  </span>
                </span>
                <i class="ti ti-plus text-primary"></i>
              </button>
            </div>
          </div>

          <div v-if="selected.length === 0" class="text-center text-gray-5 py-4">
            <i class="ti ti-barcode fs-24 d-block mb-2"></i>
            Search for products above to add them to the print list.
          </div>

          <ul v-else class="selected-list list-unstyled mb-0">
            <li v-for="(item, i) in selected" :key="item.product.id" class="selected-item">
              <div class="min-w-0 flex-grow-1">
                <div class="fw-medium text-gray-9 text-break">{{ item.product.name }}</div>
                <div class="fs-12 text-gray-5 text-break">
                  {{ isBarcode ? 'Barcode' : 'QR' }}: {{ codeValue(item.product) }} · {{ formatMoney(item.product.priceCents) }}
                </div>
                <div v-if="failed[codeValue(item.product)]" class="fs-12 text-danger">
                  {{ failed[codeValue(item.product)] }}
                </div>
              </div>
              <div class="d-flex align-items-center gap-2 flex-shrink-0">
                <div class="copies input-group input-group-sm">
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    aria-label="Fewer labels"
                    :disabled="item.copies <= 1"
                    @click="setCopies(item, item.copies - 1)"
                  >
                    <i class="ti ti-minus"></i>
                  </button>
                  <input
                    :value="item.copies"
                    type="number"
                    class="form-control text-center"
                    min="1"
                    :max="MAX_COPIES"
                    inputmode="numeric"
                    :aria-label="`Labels for ${item.product.name}`"
                    @change="setCopies(item, Number(($event.target as HTMLInputElement).value))"
                  />
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    aria-label="More labels"
                    :disabled="item.copies >= MAX_COPIES"
                    @click="setCopies(item, item.copies + 1)"
                  >
                    <i class="ti ti-plus"></i>
                  </button>
                </div>
                <button type="button" class="remove-btn" title="Remove" @click="removeSelected(i)">
                  <i class="ti ti-trash"></i>
                </button>
              </div>
            </li>
          </ul>
          <div v-if="selected.length > 0" class="d-flex justify-content-between align-items-center mt-3 fs-13">
            <span class="text-gray-5">{{ totalLabels }} {{ totalLabels === 1 ? 'label' : 'labels' }}</span>
            <button type="button" class="btn btn-sm btn-link text-danger p-0" @click="selected = []">Clear all</button>
          </div>
        </div>
      </div>
    </div>

    <div class="col-lg-5">
      <!-- Settings -->
      <div class="card mb-0 h-100">
        <div class="card-header">
          <h5 class="card-title mb-0"><i class="ti ti-settings me-1 text-primary"></i>Label Settings</h5>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-sm-6 col-lg-12">
              <label class="form-label" for="label-size">Label Size</label>
              <select id="label-size" v-model="settings.sizeId" class="form-select">
                <option v-for="s in SIZES" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="col-sm-6 col-lg-12">
              <label class="form-label" for="label-paper">Paper</label>
              <select id="label-paper" v-model="settings.paper" class="form-select">
                <option value="a4">A4 sheet (many labels per page)</option>
                <option value="roll">Label printer (one label per page)</option>
              </select>
            </div>
            <div v-if="!isBarcode" class="col-12">
              <label class="form-label" for="label-qr-content">QR Code Contains</label>
              <select id="label-qr-content" v-model="settings.qrContent" class="form-select">
                <option value="sku">SKU</option>
                <option value="barcode">Barcode (SKU if none)</option>
              </select>
            </div>
            <div class="col-12">
              <span class="form-label d-block">Show on Label</span>
              <div class="d-flex flex-wrap gap-3">
                <div class="form-check mb-0">
                  <input id="label-show-store" v-model="settings.showStore" class="form-check-input" type="checkbox" />
                  <label class="form-check-label" for="label-show-store">Store name</label>
                </div>
                <div class="form-check mb-0">
                  <input id="label-show-name" v-model="settings.showName" class="form-check-input" type="checkbox" />
                  <label class="form-check-label" for="label-show-name">Product name</label>
                </div>
                <div class="form-check mb-0">
                  <input id="label-show-price" v-model="settings.showPrice" class="form-check-input" type="checkbox" />
                  <label class="form-check-label" for="label-show-price">Price</label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Preview -->
  <div class="card mt-3">
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="card-title mb-0"><i class="ti ti-eye me-1 text-primary"></i>Preview</h5>
      <span v-if="labels.length" class="fs-13 text-gray-5">Shown at actual size</span>
    </div>
    <div class="card-body preview">
      <div v-if="tooMany" class="alert alert-warning py-2 mb-0" role="alert">
        That's {{ totalLabels }} labels. Print up to {{ MAX_LABELS }} at a time.
      </div>
      <div v-else-if="labels.length === 0" class="text-center text-gray-5 py-4">Labels appear here.</div>
      <div v-else class="label-grid">
        <div
          v-for="label in labels"
          :key="label.key"
          class="label"
          :class="isBarcode ? 'label-barcode' : 'label-qr'"
          :style="labelStyle"
        >
          <div v-if="!isBarcode" class="label-code" v-html="svgs[label.value] ?? ''"></div>
          <div class="label-text">
            <div v-if="settings.showStore && storeName" class="label-store">{{ storeName }}</div>
            <div v-if="settings.showName" class="label-name">{{ label.product.name }}</div>
            <div v-if="settings.showPrice" class="label-price">{{ formatMoney(label.product.priceCents) }}</div>
            <div v-if="!isBarcode" class="label-value">{{ label.value }}</div>
          </div>
          <div v-if="isBarcode" class="label-code" v-html="svgs[label.value] ?? ''"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- The copy that prints (hidden on screen) -->
  <Teleport to="body">
    <div class="label-print-root" :class="`paper-${settings.paper}`">
      <div
        v-for="label in labels"
        :key="label.key"
        class="label"
        :class="isBarcode ? 'label-barcode' : 'label-qr'"
        :style="labelStyle"
      >
        <div v-if="!isBarcode" class="label-code" v-html="svgs[label.value] ?? ''"></div>
        <div class="label-text">
          <div v-if="settings.showStore && storeName" class="label-store">{{ storeName }}</div>
          <div v-if="settings.showName" class="label-name">{{ label.product.name }}</div>
          <div v-if="settings.showPrice" class="label-price">{{ formatMoney(label.product.priceCents) }}</div>
          <div v-if="!isBarcode" class="label-value">{{ label.value }}</div>
        </div>
        <div v-if="isBarcode" class="label-code" v-html="svgs[label.value] ?? ''"></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.product-search {
  position: relative;
}

.product-search .search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #a6aaaf;
  pointer-events: none;
}

.product-search input {
  padding-left: 32px;
}

.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.search-result {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid #f2f4f7;
  background: #ffffff;
}

.search-result:last-child {
  border-bottom: 0;
}

.search-result:hover {
  background: #f9fafb;
}

.product-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 16px;
  overflow: hidden;
}

.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.selected-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 10px 0;
  border-bottom: 1px solid #e6eaed;
}

.selected-item:first-child {
  padding-top: 0;
}

.copies {
  width: 120px;
  flex-wrap: nowrap;
}

/* Hide the browser's own up/down arrows; the +/- buttons do that job */
.copies input::-webkit-outer-spin-button,
.copies input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.copies input {
  -moz-appearance: textfield;
  appearance: textfield;
}

.remove-btn {
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

.remove-btn:hover {
  background: #e6eaed;
}

.preview {
  background: #f9fafb;
  overflow-x: auto;
}

.label-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.label-grid .label {
  border: 1px dashed #d0d5dd;
  background: #ffffff;
}

.min-w-0 {
  min-width: 0;
}

@media (max-width: 575.98px) {
  .page-actions,
  .page-actions .btn {
    width: 100%;
  }

  .selected-item > .d-flex {
    width: 100%;
    justify-content: space-between;
  }
}
</style>

<!-- Label layout and print rules. Not scoped: the print copy is teleported outside this component. -->
<style>
.label {
  --label-scale: 1;
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  padding: 1.5mm 2mm;
  color: #000000;
  font-family: Arial, Helvetica, sans-serif;
  line-height: 1.15;
  break-inside: avoid;
}

.label-barcode {
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
}

.label-qr {
  flex-direction: row;
  align-items: center;
  gap: 2mm;
}

.label-text {
  min-width: 0;
}

.label-qr .label-text {
  flex: 1;
}

.label-store {
  font-size: calc(6pt * var(--label-scale));
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.label-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: calc(7pt * var(--label-scale));
}

.label-price {
  font-size: calc(9pt * var(--label-scale));
  font-weight: 700;
}

.label-value {
  margin-top: 0.5mm;
  font-size: calc(6pt * var(--label-scale));
  word-break: break-all;
}

.label-code {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.label-code svg {
  display: block;
  width: 100%;
  height: 100%;
}

.label-barcode .label-code {
  flex: 1;
  margin-top: 0.5mm;
}

.label-qr .label-code {
  height: 100%;
  aspect-ratio: 1;
  flex-shrink: 0;
}

/* The print copy is only for the printer */
.label-print-root {
  display: none;
}

@media print {
  body.label-print-page > *:not(.label-print-root) {
    display: none !important;
  }

  body.label-print-page {
    background: #ffffff !important;
  }

  body.label-print-page .label-print-root {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 2mm;
  }

  /* Page breaks don't work between flex items, so roll labels stack as blocks */
  body.label-print-page .label-print-root.paper-roll {
    display: block;
  }

  .label-print-root.paper-roll .label {
    break-after: page;
  }

  .label-print-root .label {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .label-print-root.paper-a4 .label {
    outline: 0.2mm dashed #cccccc; /* cutting guide */
  }
}
</style>
