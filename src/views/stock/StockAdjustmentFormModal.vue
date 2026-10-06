<script setup lang="ts">
// "New stock adjustment" dialog. Pass `product` to adjust that product, or null to pick one here.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatQuantity, listProducts, type Product } from '@/api/products'
import {
  ADJUSTMENT_REASONS,
  createStockAdjustment,
  reasonLabel,
  type AdjustmentMode,
  type AdjustmentReason,
  type StockAdjustment,
} from '@/api/stock'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ product: Product | null }>()
const emit = defineEmits<{ close: []; saved: [adjustment: StockAdjustment] }>()

const MAX_NOTE_LENGTH = 500

const MODES: { value: AdjustmentMode; label: string; icon: string }[] = [
  { value: 'add', label: 'Add', icon: 'circle-plus' },
  { value: 'remove', label: 'Remove', icon: 'circle-minus' },
  { value: 'set', label: 'Set count', icon: 'clipboard-check' },
]

// Picking a mode picks the usual reason for it, unless a different reason was chosen
const DEFAULT_REASON: Record<AdjustmentMode, AdjustmentReason> = {
  add: 'received',
  remove: 'damaged',
  set: 'count',
}

const selected = ref<Product | null>(props.product)
const mode = ref<AdjustmentMode>('add')
const quantityText = ref('')
const reason = ref<AdjustmentReason>(DEFAULT_REASON.add)
const note = ref('')
const error = ref('')
const saving = ref(false)

watch(mode, (next, previous) => {
  if (reason.value === DEFAULT_REASON[previous]) reason.value = DEFAULT_REASON[next]
})

// --- Product search (only when no product was passed in) ---

const search = ref('')
const results = ref<Product[]>([])
const searching = ref(false)
const searchError = ref('')
let latestSearch = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch() {
  const requestId = ++latestSearch
  searching.value = true
  searchError.value = ''
  try {
    const result = await listProducts({
      search: search.value.trim(),
      status: '',
      categoryId: null,
      subcategoryId: null,
      brandId: null,
      page: 1,
      pageSize: 8,
    })
    if (requestId === latestSearch) results.value = result.items
  } catch (e) {
    if (requestId === latestSearch) searchError.value = e instanceof Error ? e.message : 'Could not search products'
  } finally {
    if (requestId === latestSearch) searching.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))
if (!selected.value) runSearch()

function pick(product: Product) {
  selected.value = product
  error.value = ''
}

function changeProduct() {
  selected.value = null
  if (results.value.length === 0) runSearch()
}

// --- Quantity and preview ---

const unit = computed(() => selected.value?.unit ?? null)
const quantityStep = computed(() => (unit.value?.allowDecimal ? '0.001' : '1'))

/** The typed quantity, rounded to 3 decimals, or null while it isn't a number */
const quantity = computed<number | null>(() => {
  const text = quantityText.value.toString().trim()
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
})

/** The stock after saving, going by the quantity loaded with the product */
const newQuantity = computed<number | null>(() => {
  if (!selected.value || quantity.value === null) return null
  const current = selected.value.quantity
  if (mode.value === 'set') return quantity.value
  const change = mode.value === 'add' ? quantity.value : -quantity.value
  return Math.round((current + change) * 1000) / 1000
})

const quantityLabel = computed(() => (mode.value === 'set' ? 'Counted Quantity' : 'Quantity'))

/** The first problem with the form, or '' when it can be saved */
function validate(): string {
  if (!selected.value) return 'Choose a product.'
  const value = quantity.value
  if (value === null) return `${quantityLabel.value} is required.`
  if (value < 0) return `${quantityLabel.value} cannot be negative.`
  if (mode.value !== 'set' && value === 0) return 'Quantity must be more than zero.'
  if (!unit.value?.allowDecimal && !Number.isInteger(value)) {
    return `${unit.value?.name ?? 'This unit'} only allows whole numbers.`
  }
  if (mode.value === 'remove' && value > selected.value.quantity) {
    return `Only ${formatQuantity(selected.value.quantity)} ${selected.value.unit.shortName} in stock.`
  }
  if (mode.value === 'set' && value === selected.value.quantity) return 'That is already the stock on hand.'
  if (reason.value === 'other' && !note.value.trim()) return 'Add a note explaining the adjustment.'
  return ''
}

async function save() {
  error.value = validate()
  if (error.value || !selected.value || quantity.value === null) return

  saving.value = true
  try {
    const adjustment = await createStockAdjustment({
      productId: selected.value.id,
      mode: mode.value,
      quantity: quantity.value,
      reason: reason.value,
      note: note.value.trim() || null,
    })
    emit('saved', adjustment)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the adjustment'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="New Stock Adjustment" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <!-- Product -->
        <div class="mb-3">
          <label class="form-label" :for="selected ? undefined : 'adjust-product-search'">
            Product <span class="text-danger">*</span>
          </label>

          <div v-if="selected" class="picked-product">
            <span class="product-image">
              <img v-if="selected.imageUrl" :src="selected.imageUrl" :alt="selected.name" />
              <i v-else class="ti ti-box"></i>
            </span>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ selected.name }}</div>
              <div class="fs-12 text-gray-5 text-break">
                {{ selected.sku }} · In stock: {{ formatQuantity(selected.quantity) }} {{ selected.unit.shortName }}
              </div>
            </div>
            <button v-if="!product" type="button" class="btn btn-sm btn-white border flex-shrink-0" @click="changeProduct">
              Change
            </button>
          </div>

          <div v-else>
            <div class="search-input">
              <span class="search-icon"><i class="ti ti-search"></i></span>
              <input
                id="adjust-product-search"
                v-model="search"
                type="search"
                class="form-control"
                placeholder="Search name, SKU or barcode"
                autocomplete="off"
                autofocus
              />
            </div>
            <div class="search-results" :class="{ 'is-loading': searching }">
              <div v-if="searchError" class="text-danger fs-13 p-2">{{ searchError }}</div>
              <button v-for="item in results" :key="item.id" type="button" class="search-result" @click="pick(item)">
                <span class="product-image product-image-sm">
                  <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name" loading="lazy" />
                  <i v-else class="ti ti-box"></i>
                </span>
                <span class="flex-grow-1 min-w-0 text-start">
                  <span class="d-block fw-medium text-gray-9 text-truncate">{{ item.name }}</span>
                  <span class="d-block fs-12 text-gray-5 text-truncate">
                    {{ item.sku }}<template v-if="item.status === 'inactive'"> · Inactive</template>
                  </span>
                </span>
                <span class="fs-13 text-nowrap">{{ formatQuantity(item.quantity) }} {{ item.unit.shortName }}</span>
              </button>
              <div v-if="!searching && !searchError && results.length === 0" class="text-gray-5 fs-13 p-2 text-center">
                No products found.
              </div>
            </div>
          </div>
        </div>

        <!-- Add / remove / set -->
        <div class="mb-3">
          <span class="form-label d-block" id="adjust-mode-label">Adjustment</span>
          <div class="mode-picker" role="radiogroup" aria-labelledby="adjust-mode-label">
            <button
              v-for="m in MODES"
              :key="m.value"
              type="button"
              role="radio"
              :aria-checked="mode === m.value"
              :class="[`mode-${m.value}`, { active: mode === m.value }]"
              @click="mode = m.value"
            >
              <i class="ti" :class="`ti-${m.icon}`"></i>{{ m.label }}
            </button>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-sm-6">
            <label class="form-label" for="adjust-quantity">{{ quantityLabel }} <span class="text-danger">*</span></label>
            <div class="input-group">
              <input
                id="adjust-quantity"
                v-model="quantityText"
                type="number"
                class="form-control"
                min="0"
                :step="quantityStep"
                :inputmode="unit?.allowDecimal ? 'decimal' : 'numeric'"
                placeholder="0"
              />
              <span v-if="unit" class="input-group-text">{{ unit.shortName }}</span>
            </div>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="adjust-reason">Reason <span class="text-danger">*</span></label>
            <select id="adjust-reason" v-model="reason" class="form-select">
              <option v-for="r in ADJUSTMENT_REASONS" :key="r" :value="r">{{ reasonLabel(r) }}</option>
            </select>
          </div>
        </div>

        <!-- Before / after -->
        <div v-if="selected" class="stock-preview mb-3">
          <div>
            <div class="fs-12 text-gray-5">Current</div>
            <div class="fw-medium text-gray-9">{{ formatQuantity(selected.quantity) }} {{ selected.unit.shortName }}</div>
          </div>
          <i class="ti ti-arrow-right text-gray-5"></i>
          <div class="text-end">
            <div class="fs-12 text-gray-5">After</div>
            <div
              class="fw-medium"
              :class="newQuantity === null ? 'text-gray-5' : newQuantity < 0 ? 'text-danger' : 'text-gray-9'"
            >
              <template v-if="newQuantity === null">—</template>
              <template v-else>{{ formatQuantity(newQuantity) }} {{ selected.unit.shortName }}</template>
            </div>
          </div>
        </div>

        <div>
          <label class="form-label" for="adjust-note">
            Note <span v-if="reason === 'other'" class="text-danger">*</span>
            <span v-else class="text-gray-5 fw-normal">(optional)</span>
          </label>
          <textarea
            id="adjust-note"
            v-model="note"
            class="form-control"
            rows="2"
            :maxlength="MAX_NOTE_LENGTH"
            placeholder="e.g. Delivery receipt #1234, or what happened"
          ></textarea>
          <div class="form-text">Adjustments can't be edited or deleted. To fix a mistake, add another adjustment.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save Adjustment' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.picked-product {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #f9fafb;
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
  max-height: 240px;
  margin-top: 6px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
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

.search-result:hover,
.search-result:focus-visible {
  background: #fff6ee;
}

.mode-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.mode-picker button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 6px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #646b72;
  font-weight: 500;
  white-space: nowrap;
}

.mode-picker button.active.mode-add {
  border-color: #3eb780;
  background: #3eb780;
  color: #ffffff;
}

.mode-picker button.active.mode-remove {
  border-color: #ff0000;
  background: #ff0000;
  color: #ffffff;
}

.mode-picker button.active.mode-set {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

.stock-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f9fafb;
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
  background: #ffffff;
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
  opacity: 0.5;
  transition: opacity 0.15s;
}

@media (max-width: 379.98px) {
  .mode-picker button {
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
}
</style>
