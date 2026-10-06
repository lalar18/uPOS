<script setup lang="ts">
// Create (/quotations/create) or edit (/quotations/:id/edit) a quotation. Quotations are
// offers, so anyone may set the prices, and stock isn't checked until it becomes a sale.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { PickedCustomer } from '@/api/customers'
import { formatPeso } from '@/api/products'
import {
  createQuotation,
  getQuotation,
  QUOTATION_STATUSES,
  quotationStatusLabel,
  updateQuotation,
  type EditableQuotationStatus,
} from '@/api/quotations'
import { computeTotals } from '@/api/sales'
import CustomerPicker from '@/components/CustomerPicker.vue'
import { addDays, toIsoDate } from '@/utils/date'
import { centsToText, newUid, parsePercentBp, parsePeso } from '@/utils/money'
import DocumentTotals from '../sales/DocumentTotals.vue'
import LineItemsEditor from '../sales/LineItemsEditor.vue'
import { lineCents, toItems, validateLines, type EditorLine } from '../sales/lines'

const props = defineProps<{ id?: string }>()

const router = useRouter()
const editingId = props.id ? Number(props.id) : null
const uid = newUid() // reused if saving a new quotation is retried

const customer = ref<PickedCustomer | null>(null)
const quoteDate = ref(toIsoDate())
const validUntil = ref(addDays(toIsoDate(), 15))
const status = ref<EditableQuotationStatus>('draft')
const note = ref('')
const lines = ref<EditorLine[]>([])
const discountText = ref('')
const taxText = ref('')

const reference = ref('')
const skippedItems = ref<string[]>([])
const loading = ref(false)
const loadError = ref('')
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

// --- Loading for edit ---

async function load(id: number) {
  loading.value = true
  try {
    const quotation = await getQuotation(id)
    if (quotation.status === 'converted') {
      router.replace({ name: 'quotation-detail', params: { id } })
      return
    }
    reference.value = quotation.reference
    if (quotation.customer.id !== null) {
      customer.value = { id: quotation.customer.id, name: quotation.customer.name, phone: quotation.customer.phone }
    }
    quoteDate.value = quotation.quoteDate
    validUntil.value = quotation.validUntil ?? ''
    status.value = quotation.status
    note.value = quotation.note ?? ''
    discountText.value = quotation.discountCents > 0 ? centsToText(quotation.discountCents) : ''
    taxText.value = quotation.taxRateBp > 0 ? String(quotation.taxRateBp / 100) : ''
    for (const item of quotation.items) {
      if (item.productId === null || !item.product) {
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
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the quotation'
  } finally {
    loading.value = false
  }
}

if (editingId !== null) load(editingId)

// --- Saving ---

function validate(): string {
  const linesError = validateLines(lines.value, false)
  if (linesError) return linesError
  if (discountError.value) return `Discount: ${discountError.value.toLowerCase()}.`
  if (taxError.value) return 'Tax rate must be a percent from 0 to 100.'
  if (!quoteDate.value) return 'Choose the quotation date.'
  if (quoteDate.value > toIsoDate()) return 'The quotation date cannot be in the future.'
  if (validUntil.value && validUntil.value < quoteDate.value) return 'Valid until cannot be before the quotation date.'
  return ''
}

async function save() {
  error.value = validate()
  if (error.value) return
  const input = {
    uid,
    customerId: customer.value?.id ?? null,
    quoteDate: quoteDate.value,
    validUntil: validUntil.value || null,
    status: status.value,
    items: toItems(lines.value),
    discountCents: totals.value.discountCents,
    taxRateBp: totals.value.taxRateBp,
    note: note.value.trim() || null,
  }
  saving.value = true
  try {
    const saved = editingId === null ? await createQuotation(input) : await updateQuotation(editingId, input)
    router.replace({ name: 'quotation-detail', params: { id: saved.id } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the quotation'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ editingId === null ? 'New Quotation' : `Edit ${reference || 'Quotation'}` }}</h4>
      <h6>Prices offered here don't change your product prices or stock</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <RouterLink
        :to="editingId === null ? { name: 'quotations' } : { name: 'quotation-detail', params: { id: editingId } }"
        class="btn btn-white border"
      >
        <i class="ti ti-arrow-left me-1"></i>Back
      </RouterLink>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="skippedItems.length" class="alert alert-warning py-2" role="alert">
    Left out because the product was deleted: {{ skippedItems.join(', ') }}. Saving removes them from the quotation.
  </div>

  <form v-if="!loadError" novalidate :class="{ 'is-loading': loading }" @submit.prevent="save">
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card mb-0 h-100">
          <div class="card-header"><h5 class="card-title mb-0">Products</h5></div>
          <div class="card-body">
            <LineItemsEditor v-model="lines" :can-edit-price="true" :check-stock="false" />
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card mb-3">
          <div class="card-body">
            <div class="mb-3">
              <label class="form-label" for="quote-customer">Customer</label>
              <CustomerPicker id="quote-customer" v-model="customer" />
            </div>
            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label" for="quote-date">Date <span class="text-danger">*</span></label>
                <input id="quote-date" v-model="quoteDate" type="date" class="form-control" :max="toIsoDate()" />
              </div>
              <div class="col-6">
                <label class="form-label" for="quote-valid">Valid until</label>
                <input id="quote-valid" v-model="validUntil" type="date" class="form-control" :min="quoteDate" />
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="quote-status">Status</label>
              <select id="quote-status" v-model="status" class="form-select">
                <option v-for="s in QUOTATION_STATUSES" :key="s" :value="s">{{ quotationStatusLabel(s) }}</option>
              </select>
            </div>
            <div>
              <label class="form-label" for="quote-note">
                Note <span class="text-gray-5 fw-normal">(optional, printed on the quotation)</span>
              </label>
              <textarea
                id="quote-note"
                v-model="note"
                class="form-control"
                rows="3"
                maxlength="500"
                placeholder="e.g. Delivery in 3 days. Prices include VAT."
              ></textarea>
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
            <div v-if="error" class="alert alert-danger py-2 mt-3 mb-0" role="alert">{{ error }}</div>
            <button type="submit" class="btn btn-primary w-100 mt-3" :disabled="saving || loading">
              {{ saving ? 'Saving…' : `Save Quotation · ${formatPeso(totals.totalCents)}` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
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
