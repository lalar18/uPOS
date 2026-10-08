<script setup lang="ts">
// "New sales return" dialog. Pass `saleId` to return items from that sale, or null to find
// the sale here. The credit and refund shown are worked out the same way the API does.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatQuantity } from '@/api/products'
import {
  getSale,
  lineTotal,
  listSales,
  PAYMENT_METHODS,
  paymentMethodLabel,
  type PaymentMethod,
  type Sale,
  type SaleItem,
  type SaleSummary,
} from '@/api/sales'
import {
  createSalesReturn,
  RETURN_REASONS,
  returnReasonLabel,
  type ReturnReason,
  type SalesReturn,
} from '@/api/salesReturns'
import AppModal from '@/components/AppModal.vue'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { formatMoney, newUid } from '@/utils/money'

const props = defineProps<{ saleId: number | null }>()
const emit = defineEmits<{ close: []; saved: [salesReturn: SalesReturn] }>()

// Reused if saving is retried, so a return whose response was lost is never saved twice
const uid = newUid()

const sale = ref<Sale | null>(null)
const quantities = ref<Record<number, string>>({}) // sale item id -> typed quantity
const loadingSale = ref(false)
const error = ref('')

async function pickSale(id: number) {
  loadingSale.value = true
  error.value = ''
  try {
    sale.value = await getSale(id)
    quantities.value = {}
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the sale'
  } finally {
    loadingSale.value = false
  }
}

// --- Finding the sale (when none was passed in) ---

const search = ref('')
const results = ref<SaleSummary[]>([])
const searching = ref(false)
let latestSearch = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch() {
  const requestId = ++latestSearch
  searching.value = true
  try {
    const result = await listSales({
      search: search.value.trim(),
      payment: '',
      source: '',
      from: null,
      to: null,
      today: toIsoDate(),
      page: 1,
      pageSize: 8,
    })
    if (requestId === latestSearch) results.value = result.items.filter((s) => s.returnStatus !== 'full')
  } catch (e) {
    if (requestId === latestSearch) error.value = e instanceof Error ? e.message : 'Could not search sales'
  } finally {
    if (requestId === latestSearch) searching.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

if (props.saleId) pickSale(props.saleId)
else runSearch()

function changeSale() {
  sale.value = null
  if (results.value.length === 0) runSearch()
}

// --- Items and quantities ---

const returnable = (item: SaleItem) => Math.round((item.quantity - item.returnedQuantity) * 1000) / 1000
const returnableItems = computed(() => (sale.value?.items ?? []).filter((item) => returnable(item) > 0))

/** The typed quantity for an item: 0 when blank, null when invalid */
function quantityOf(item: SaleItem): number | null {
  const text = String(quantities.value[item.id] ?? '').trim()
  if (text === '') return 0
  const value = Math.round(Number(text) * 1000) / 1000
  if (!Number.isFinite(value) || value < 0 || value > returnable(item)) return null
  if (!item.allowDecimal && item.productId !== null && !Number.isInteger(value)) return null
  return value
}

function returnAll() {
  for (const item of returnableItems.value) quantities.value[item.id] = String(returnable(item))
}

const reason = ref<ReturnReason>('changed_mind')
const restock = ref(true)
const note = ref('')
const returnDate = ref(toIsoDate())
const refundMethod = ref<PaymentMethod>('cash')

// Damaged or expired goods usually can't be sold again
watch(reason, (value) => {
  restock.value = value !== 'defective' && value !== 'expired'
})

const chosen = computed(() =>
  returnableItems.value
    .map((item) => ({ item, quantity: quantityOf(item) }))
    .filter((c): c is { item: SaleItem; quantity: number } => c.quantity !== null && c.quantity > 0),
)

/** What the return credits and refunds (same rules as worker/salesReturns.ts) */
const preview = computed(() => {
  const s = sale.value
  if (!s || chosen.value.length === 0) return { creditCents: 0, refundCents: 0 }
  const gross = chosen.value.reduce((sum, c) => sum + lineTotal(c.quantity, c.item.priceCents), 0)
  const remaining = s.totalCents - s.returnedCents
  const everything = s.items.every((item) => {
    const c = chosen.value.find((x) => x.item.id === item.id)
    return Math.round((returnable(item) - (c?.quantity ?? 0)) * 1000) / 1000 <= 0
  })
  const creditCents = everything
    ? remaining
    : Math.min(s.subtotalCents > 0 ? Math.round((gross * s.totalCents) / s.subtotalCents) : 0, remaining)
  return { creditCents, refundCents: Math.max(s.paidCents - (remaining - creditCents), 0) }
})

const saving = ref(false)

function validate(): string {
  if (!sale.value) return 'Choose the sale being returned.'
  for (const item of returnableItems.value) {
    if (quantityOf(item) === null) {
      return `Return between 0 and ${formatQuantity(returnable(item))} ${item.unitShortName} of ${item.name}.`
    }
  }
  if (chosen.value.length === 0) return 'Enter how many of each item are being returned.'
  if (!returnDate.value) return 'Choose the return date.'
  if (returnDate.value > toIsoDate()) return 'The return date cannot be in the future.'
  if (returnDate.value < sale.value.saleDate) return 'The return date cannot be before the sale date.'
  if (reason.value === 'other' && !note.value.trim()) return 'Add a note explaining the return.'
  return ''
}

async function save() {
  error.value = validate()
  if (error.value || !sale.value) return
  saving.value = true
  try {
    const saved = await createSalesReturn({
      uid,
      saleId: sale.value.id,
      returnDate: returnDate.value,
      reason: reason.value,
      restock: restock.value,
      note: note.value.trim() || null,
      refundMethod: preview.value.refundCents > 0 ? refundMethod.value : null,
      items: chosen.value.map((c) => ({ saleItemId: c.item.id, quantity: c.quantity })),
    })
    emit('saved', saved)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the return'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="New Sales Return" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <!-- The sale -->
        <div class="mb-3">
          <label class="form-label" :for="sale ? undefined : 'return-sale-search'">
            Sale <span class="text-danger">*</span>
          </label>
          <div v-if="sale" class="picked-sale">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9">{{ sale.reference }} · {{ sale.customer.name }}</div>
              <div class="fs-12 text-gray-5">
                {{ formatIsoDate(sale.saleDate) }} · Total {{ formatMoney(sale.totalCents) }} · Paid
                {{ formatMoney(sale.paidCents) }}
              </div>
            </div>
            <button v-if="!saleId" type="button" class="btn btn-sm btn-white border flex-shrink-0" @click="changeSale">
              Change
            </button>
          </div>
          <div v-else>
            <div class="search-input">
              <span class="search-icon"><i class="ti ti-search"></i></span>
              <input
                id="return-sale-search"
                v-model="search"
                type="search"
                class="form-control"
                placeholder="Invoice no. or customer name"
                autocomplete="off"
                autofocus
              />
            </div>
            <div class="search-results" :class="{ 'is-loading': searching || loadingSale }">
              <button v-for="item in results" :key="item.id" type="button" class="search-result" @click="pickSale(item.id)">
                <span class="min-w-0 text-start">
                  <span class="d-block fw-medium text-gray-9">{{ item.reference }} · {{ item.customer.name }}</span>
                  <span class="d-block fs-12 text-gray-5">{{ formatIsoDate(item.saleDate) }} · {{ item.itemCount }} items</span>
                </span>
                <span class="fs-13 fw-medium text-nowrap">{{ formatMoney(item.totalCents) }}</span>
              </button>
              <div v-if="!searching && results.length === 0" class="text-gray-5 fs-13 p-2 text-center">No sales found.</div>
            </div>
          </div>
        </div>

        <template v-if="sale">
          <div v-if="returnableItems.length === 0" class="alert alert-info py-2">Everything on this sale has been returned.</div>

          <template v-else>
            <!-- Items -->
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="form-label mb-0">Items returned <span class="text-danger">*</span></span>
              <button type="button" class="btn btn-link btn-sm p-0" @click="returnAll">Return everything</button>
            </div>
            <div class="return-items mb-3">
              <div v-for="item in returnableItems" :key="item.id" class="return-item">
                <div class="min-w-0 flex-grow-1">
                  <div class="fw-medium text-gray-9 text-break">{{ item.name }}</div>
                  <div class="fs-12 text-gray-5">
                    Sold {{ formatQuantity(item.quantity) }} {{ item.unitShortName }} × {{ formatMoney(item.priceCents) }}
                    <template v-if="item.returnedQuantity > 0">
                      · {{ formatQuantity(item.returnedQuantity) }} already returned
                    </template>
                  </div>
                </div>
                <div class="return-qty">
                  <div class="input-group input-group-sm">
                    <input
                      v-model="quantities[item.id]"
                      type="number"
                      class="form-control"
                      min="0"
                      :max="returnable(item)"
                      :step="item.allowDecimal ? '0.001' : '1'"
                      :inputmode="item.allowDecimal ? 'decimal' : 'numeric'"
                      placeholder="0"
                      :class="{ 'is-invalid': quantityOf(item) === null }"
                      :aria-label="`Quantity of ${item.name} returned`"
                    />
                    <span class="input-group-text">/ {{ formatQuantity(returnable(item)) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="row g-3 mb-3">
              <div class="col-sm-6">
                <label class="form-label" for="return-reason">Reason <span class="text-danger">*</span></label>
                <select id="return-reason" v-model="reason" class="form-select">
                  <option v-for="r in RETURN_REASONS" :key="r" :value="r">{{ returnReasonLabel(r) }}</option>
                </select>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="return-date">Return date <span class="text-danger">*</span></label>
                <input
                  id="return-date"
                  v-model="returnDate"
                  type="date"
                  class="form-control"
                  :min="sale.saleDate"
                  :max="toIsoDate()"
                />
              </div>
            </div>

            <div class="form-check mb-3">
              <input id="return-restock" v-model="restock" class="form-check-input" type="checkbox" />
              <label class="form-check-label" for="return-restock">
                Put the items back in stock
                <span class="d-block fs-12 text-gray-5">Leave unticked for damaged or expired goods that can't be sold.</span>
              </label>
            </div>

            <div class="mb-3">
              <label class="form-label" for="return-note">
                Note <span v-if="reason === 'other'" class="text-danger">*</span>
                <span v-else class="text-gray-5 fw-normal">(optional)</span>
              </label>
              <textarea id="return-note" v-model="note" class="form-control" rows="2" maxlength="500"></textarea>
            </div>

            <!-- Credit and refund -->
            <div class="return-preview">
              <div class="d-flex justify-content-between">
                <span>Credited to the sale</span>
                <span class="fw-semibold text-gray-9">{{ formatMoney(preview.creditCents) }}</span>
              </div>
              <div class="d-flex justify-content-between align-items-center gap-2 mt-2">
                <span>Refund to customer</span>
                <span class="fw-bold" :class="preview.refundCents > 0 ? 'text-danger' : 'text-gray-5'">
                  {{ formatMoney(preview.refundCents) }}
                </span>
              </div>
              <div v-if="preview.refundCents > 0" class="d-flex justify-content-between align-items-center gap-2 mt-2">
                <label class="mb-0" for="return-refund-method">Refund by</label>
                <select id="return-refund-method" v-model="refundMethod" class="form-select form-select-sm refund-method">
                  <option v-for="m in PAYMENT_METHODS" :key="m" :value="m">{{ paymentMethodLabel(m) }}</option>
                </select>
              </div>
              <div v-else-if="chosen.length > 0" class="fs-12 text-gray-5 mt-1">
                Nothing to refund: the credit comes off the balance still due.
              </div>
            </div>
          </template>
        </template>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving || !sale || returnableItems.length === 0">
          {{ saving ? 'Saving…' : 'Save Return' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.picked-sale {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  max-height: 260px;
  margin-top: 6px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  overflow-y: auto;
}

.search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.return-items {
  border: 1px solid #e6eaed;
  border-radius: 8px;
}

.return-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e6eaed;
}

.return-item:last-child {
  border-bottom: 0;
}

.return-qty {
  flex-shrink: 0;
  width: 150px;
}

.return-preview {
  padding: 12px 14px;
  border-radius: 8px;
  background: #f9fafb;
}

.refund-method {
  width: auto;
  min-width: 140px;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.6;
}

/* Phones: quantity goes under the item name */
@media (max-width: 575.98px) {
  .return-item {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .return-qty {
    width: 100%;
  }
}
</style>
