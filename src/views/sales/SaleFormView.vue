<script setup lang="ts">
// New sale from the back office (/sales/create), e.g. an order taken by phone or sold on
// credit. Open with ?quotation=<id> to convert a quotation: its customer, items and prices
// are filled in, and saving marks it converted. Selling at the till is done on the POS page.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PickedCustomer } from '@/api/customers'
import { getQuotation } from '@/api/quotations'
import {
  computeTotals,
  createSale,
  PAYMENT_METHODS,
  paymentMethodLabel,
  WALK_IN_CUSTOMER,
  type PaymentInput,
  type PaymentMethod,
} from '@/api/sales'
import { getSettingsOrDefaults, taxRateText } from '@/api/settings'
import { can } from '@/auth'
import CustomerPicker from '@/components/CustomerPicker.vue'
import { toIsoDate } from '@/utils/date'
import { centsToText, currencySymbol, formatMoney, newUid, parsePercentBp, parsePeso } from '@/utils/money'
import DocumentTotals from './DocumentTotals.vue'
import LineItemsEditor from './LineItemsEditor.vue'
import { lineCents, toItems, validateLines, type EditorLine } from './lines'

type PaymentMode = 'full' | 'partial' | 'none'

const route = useRoute()
const router = useRouter()
const canSetPrice = computed(() => can('sales.price'))

// Reused if saving is retried, so a sale whose response was lost is never saved twice
const uid = newUid()

const customer = ref<PickedCustomer | null>(null)
const saleDate = ref(toIsoDate())
const dueDate = ref('')
const note = ref('')
const lines = ref<EditorLine[]>([])
const discountText = ref('')
const taxText = ref('')

const paymentMode = ref<PaymentMode>('full')
const method = ref<PaymentMethod>('cash')
const amountText = ref('') // partial payments
const receivedText = ref('') // cash handed over, for working out change
const reference = ref('')

const error = ref('')
const saving = ref(false)

// --- Totals ---

const discountCents = computed(() => parsePeso(discountText.value) ?? 0)
const taxRateBp = computed(() => parsePercentBp(taxText.value))
const subtotalCents = computed(() => lines.value.reduce((sum, line) => sum + lineCents(line), 0))
const discountError = computed(() => {
  if (Number.isNaN(discountCents.value)) return 'Enter an amount like 25.00'
  return discountCents.value > subtotalCents.value ? 'More than the subtotal' : ''
})
const taxError = computed(() => (Number.isNaN(taxRateBp.value) ? 'Enter a percent from 0 to 100' : ''))
const totals = computed(() =>
  computeTotals(
    lines.value.map(lineCents),
    discountError.value ? 0 : discountCents.value,
    taxError.value ? 0 : taxRateBp.value,
  ),
)

// --- Payment ---

const isWalkIn = computed(() => customer.value === null)
const amountCents = computed(() => {
  if (paymentMode.value === 'none') return 0
  if (paymentMode.value === 'full') return totals.value.totalCents
  return parsePeso(amountText.value)
})
const receivedCents = computed(() => parsePeso(receivedText.value))
const changeCents = computed(() => {
  const given = receivedCents.value
  const paid = amountCents.value
  if (method.value !== 'cash' || given === null || Number.isNaN(given) || paid === null || Number.isNaN(paid)) return null
  return given - paid
})

// Walk-in sales are always paid in full
watch(isWalkIn, (walkIn) => {
  if (walkIn) paymentMode.value = 'full'
})

function setPaymentMode(mode: PaymentMode) {
  paymentMode.value = mode
  if (mode === 'partial' && !amountText.value) amountText.value = centsToText(Math.floor(totals.value.totalCents / 2))
}

// --- Converting a quotation ---

const quotationId = ref<number | null>(null)
const quotationReference = ref('')
const skippedItems = ref<string[]>([]) // deleted or inactive products left out
const loadingQuotation = ref(false)
const quotationError = ref('')

async function loadQuotation(id: number) {
  loadingQuotation.value = true
  try {
    const quotation = await getQuotation(id)
    if (quotation.status === 'converted') {
      quotationError.value = `${quotation.reference} has already been converted to ${quotation.sale?.reference ?? 'a sale'}.`
      return
    }
    quotationId.value = quotation.id
    quotationReference.value = quotation.reference
    if (quotation.customer.id !== null) {
      customer.value = { id: quotation.customer.id, name: quotation.customer.name, phone: quotation.customer.phone }
    }
    for (const item of quotation.items) {
      if (item.productId === null || !item.product || item.product.status !== 'active') {
        skippedItems.value.push(item.name)
        continue
      }
      lines.value.push({
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        unitShortName: item.unitShortName,
        allowDecimal: item.product.allowDecimal,
        imageUrl: item.imageUrl,
        stock: item.product.quantity,
        catalogPriceCents: item.product.priceCents,
        quantityText: String(item.quantity),
        priceText: centsToText(item.priceCents),
      })
    }
    discountText.value = quotation.discountCents > 0 ? centsToText(quotation.discountCents) : ''
    taxText.value = quotation.taxRateBp > 0 ? String(quotation.taxRateBp / 100) : ''
    note.value = quotation.note ?? ''
  } catch (e) {
    quotationError.value = e instanceof Error ? e.message : 'Could not load the quotation'
  } finally {
    loadingQuotation.value = false
  }
}

const queryQuotation = Number(route.query.quotation)
if (Number.isSafeInteger(queryQuotation) && queryQuotation > 0) {
  loadQuotation(queryQuotation) // uses the quotation's tax rate
} else {
  // Start from the store's default tax rate (General Settings), unless the user already typed one
  getSettingsOrDefaults().then((settings) => {
    if (taxText.value === '') taxText.value = taxRateText(settings.defaultTaxRateBp)
  })
}

// --- Saving ---

function validate(): string {
  const linesError = validateLines(lines.value, true)
  if (linesError) return linesError
  if (discountError.value) return `Discount: ${discountError.value.toLowerCase()}.`
  if (taxError.value) return 'Tax rate must be a percent from 0 to 100.'
  if (!saleDate.value) return 'Choose the sale date.'
  if (saleDate.value > toIsoDate()) return 'The sale date cannot be in the future.'
  if (dueDate.value && dueDate.value < saleDate.value) return 'The due date cannot be before the sale date.'

  const amount = amountCents.value
  if (paymentMode.value === 'partial') {
    if (amount === null || Number.isNaN(amount) || amount <= 0) return 'Enter the amount paid now, like 500.00.'
    if (amount >= totals.value.totalCents) return 'A partial payment must be less than the total. Choose "Paid in full".'
  }
  if (isWalkIn.value && paymentMode.value !== 'full') {
    return `${WALK_IN_CUSTOMER} sales must be paid in full. Choose a customer to sell on credit.`
  }
  if (method.value === 'cash' && receivedCents.value !== null && paymentMode.value !== 'none') {
    if (Number.isNaN(receivedCents.value)) return 'Cash received must be an amount like 500.00.'
    if (receivedCents.value < (amount ?? 0)) return 'Cash received is less than the amount paid.'
  }
  return ''
}

async function save() {
  error.value = validate()
  if (error.value) return

  const payments: PaymentInput[] = []
  const amount = amountCents.value ?? 0
  if (amount > 0) {
    payments.push({
      amountCents: amount,
      method: method.value,
      tenderedCents: method.value === 'cash' ? receivedCents.value : null,
      reference: method.value === 'cash' ? null : reference.value.trim() || null,
    })
  }

  saving.value = true
  try {
    const sale = await createSale({
      uid,
      source: 'manual',
      customerId: customer.value?.id ?? null,
      quotationId: quotationId.value,
      saleDate: saleDate.value,
      dueDate: paymentMode.value === 'full' ? null : dueDate.value || null,
      items: toItems(lines.value),
      discountCents: totals.value.discountCents,
      taxRateBp: totals.value.taxRateBp,
      note: note.value.trim() || null,
      payments,
    })
    router.replace({ name: 'sale-detail', params: { id: sale.id } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the sale'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>New Sale</h4>
      <h6 v-if="quotationReference">Converting quotation {{ quotationReference }}</h6>
      <h6 v-else>Record a sale, paid now or on credit</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <RouterLink :to="{ name: 'sales' }" class="btn btn-white border"><i class="ti ti-arrow-left me-1"></i>Back</RouterLink>
    </div>
  </div>

  <div v-if="quotationError" class="alert alert-danger py-2" role="alert">
    {{ quotationError }}
    <RouterLink :to="{ name: 'quotations' }" class="alert-link ms-1">Back to quotations</RouterLink>
  </div>
  <div v-if="skippedItems.length" class="alert alert-warning py-2" role="alert">
    Left out because the product was deleted or is inactive: {{ skippedItems.join(', ') }}.
  </div>

  <form novalidate :class="{ 'is-loading': loadingQuotation }" @submit.prevent="save">
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card mb-0 h-100">
          <div class="card-header"><h5 class="card-title mb-0">Products</h5></div>
          <div class="card-body">
            <LineItemsEditor v-model="lines" :can-edit-price="canSetPrice" :check-stock="true" />
            <div v-if="!canSetPrice" class="form-text">
              Prices come from the product{{ quotationId ? ' or the quotation' : '' }}. Your role doesn't allow changing them.
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card mb-3">
          <div class="card-body">
            <div class="mb-3">
              <label class="form-label" for="sale-customer">Customer</label>
              <CustomerPicker id="sale-customer" v-model="customer" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="sale-date">Sale date <span class="text-danger">*</span></label>
              <input id="sale-date" v-model="saleDate" type="date" class="form-control" :max="toIsoDate()" />
            </div>
            <div>
              <label class="form-label" for="sale-note">Note <span class="text-gray-5 fw-normal">(optional)</span></label>
              <textarea id="sale-note" v-model="note" class="form-control" rows="2" maxlength="500"></textarea>
            </div>
          </div>
        </div>

        <div class="card mb-0">
          <div class="card-body">
            <DocumentTotals
              v-model:discount="discountText"
              v-model:tax="taxText"
              :totals="totals"
              :discount-error="discountError"
              :tax-error="taxError"
            />

            <hr />

            <span class="form-label d-block" id="payment-mode-label">Payment</span>
            <div class="mode-picker mb-3" role="radiogroup" aria-labelledby="payment-mode-label">
              <button
                type="button"
                role="radio"
                :aria-checked="paymentMode === 'full'"
                :class="{ active: paymentMode === 'full' }"
                @click="setPaymentMode('full')"
              >
                Paid in full
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="paymentMode === 'partial'"
                :class="{ active: paymentMode === 'partial' }"
                :disabled="isWalkIn"
                @click="setPaymentMode('partial')"
              >
                Partial
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="paymentMode === 'none'"
                :class="{ active: paymentMode === 'none' }"
                :disabled="isWalkIn"
                @click="setPaymentMode('none')"
              >
                Unpaid
              </button>
            </div>
            <div v-if="isWalkIn" class="form-text mt-n2 mb-3">Choose a customer to sell on credit.</div>

            <div v-if="paymentMode !== 'none'" class="row g-2 mb-2">
              <div v-if="paymentMode === 'partial'" class="col-12">
                <label class="form-label" for="sale-amount">Amount paid now</label>
                <div class="input-group">
                  <span class="input-group-text">{{ currencySymbol() }}</span>
                  <input id="sale-amount" v-model="amountText" type="text" class="form-control" inputmode="decimal" />
                </div>
              </div>
              <div class="col-sm-6 col-lg-12 col-xxl-6">
                <label class="form-label" for="sale-method">Method</label>
                <select id="sale-method" v-model="method" class="form-select">
                  <option v-for="m in PAYMENT_METHODS" :key="m" :value="m">{{ paymentMethodLabel(m) }}</option>
                </select>
              </div>
              <div v-if="method === 'cash'" class="col-sm-6 col-lg-12 col-xxl-6">
                <label class="form-label" for="sale-received">Cash received</label>
                <div class="input-group">
                  <span class="input-group-text">{{ currencySymbol() }}</span>
                  <input
                    id="sale-received"
                    v-model="receivedText"
                    type="text"
                    class="form-control"
                    inputmode="decimal"
                    placeholder="optional"
                  />
                </div>
              </div>
              <div v-else class="col-sm-6 col-lg-12 col-xxl-6">
                <label class="form-label" for="sale-reference">Reference no.</label>
                <input id="sale-reference" v-model="reference" type="text" class="form-control" maxlength="50" />
              </div>
              <div v-if="changeCents !== null && changeCents >= 0" class="col-12 fs-14">
                Change: <strong class="text-gray-9">{{ formatMoney(changeCents) }}</strong>
              </div>
            </div>

            <div v-if="paymentMode !== 'full'" class="mb-2">
              <label class="form-label" for="sale-due-date">
                Due date <span class="text-gray-5 fw-normal">(optional)</span>
              </label>
              <input id="sale-due-date" v-model="dueDate" type="date" class="form-control" :min="saleDate" />
            </div>

            <div v-if="error" class="alert alert-danger py-2 mt-3 mb-0" role="alert">{{ error }}</div>

            <button type="submit" class="btn btn-primary w-100 mt-3" :disabled="saving || loadingQuotation || !!quotationError">
              {{ saving ? 'Saving…' : `Save Sale · ${formatMoney(totals.totalCents)}` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
.mode-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.mode-picker button {
  padding: 7px 4px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #646b72;
  font-size: 13px;
  font-weight: 500;
}

.mode-picker button.active {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

.mode-picker button:disabled {
  opacity: 0.45;
}

.is-loading {
  opacity: 0.6;
  pointer-events: none;
}

@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions .btn {
    flex: 1;
  }
}
</style>
