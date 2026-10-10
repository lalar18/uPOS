<script setup lang="ts">
// "Record payment" dialog for an invoice with a balance due. Online methods may add a service
// charge, collected on top of the amount. Card, GCash, Maya and QR Ph can also be paid online now
// (through PayMongo, when the store has it): the dialog then waits for the customer to pay.
import { computed, ref } from 'vue'
import { chargeRateLabel, getOnlinePaymentCharge, saleChargeCents, type OnlinePaymentCharge } from '@/api/serviceCharge'
import {
  addSalePayment,
  getSale,
  isCheckoutMethod,
  MIN_CHECKOUT_CENTS,
  openSaleCheckout,
  PAYMENT_METHODS,
  paymentMethodLabel,
  type PaymentMethod,
  type Sale,
  type SaleCheckout,
  type SaleSummary,
} from '@/api/sales'
import AppModal from '@/components/AppModal.vue'
import PaymentLogos from '@/components/PaymentLogos.vue'
import SecuredByPaymongo from '@/components/SecuredByPaymongo.vue'
import { toIsoDate } from '@/utils/date'
import { centsToText, currencySymbol, formatMoney, parsePeso } from '@/utils/money'
import OnlineCheckoutModal from './OnlineCheckoutModal.vue'

const props = defineProps<{
  sale: SaleSummary
  checkout?: SaleCheckout | null // an online payment already waiting, to wait for again
}>()
const emit = defineEmits<{ close: []; saved: [sale: Sale] }>()

const amount = ref(centsToText(props.sale.dueCents))
const method = ref<PaymentMethod>('cash')
const received = ref('') // cash handed over, for working out change
const reference = ref('')
const paidDate = ref(toIsoDate())
const note = ref('')
const error = ref('')
const saving = ref(false)

const amountCents = computed(() => parsePeso(amount.value))
const receivedCents = computed(() => parsePeso(received.value))
const changeCents = computed(() => {
  const paid = amountCents.value
  const given = receivedCents.value
  if (method.value !== 'cash' || paid === null || given === null || Number.isNaN(paid) || Number.isNaN(given)) return null
  return given - paid
})

const charge = ref<OnlinePaymentCharge | null>(null)
getOnlinePaymentCharge().then((result) => (charge.value = result))

const serviceChargeCents = computed(() => {
  const paid = amountCents.value
  if (method.value === 'cash' || paid === null || Number.isNaN(paid)) return 0
  return saleChargeCents(charge.value, method.value, paid)
})

const payOnline = ref(true) // card, GCash, Maya, QR Ph: pay online now, or record a payment already made
const canPayOnline = computed(() => !!charge.value?.checkout && isCheckoutMethod(method.value))
const online = computed(() => canPayOnline.value && payOnline.value)
const checkout = ref<SaleCheckout | null>(props.checkout?.status === 'pending' ? props.checkout : null)

function validate(): string {
  const cents = amountCents.value
  if (cents === null || Number.isNaN(cents) || cents <= 0) return 'Enter the amount paid, like 150.00.'
  if (cents > props.sale.dueCents) return `The balance due is only ${formatMoney(props.sale.dueCents)}.`
  if (online.value) {
    if (cents + serviceChargeCents.value < MIN_CHECKOUT_CENTS) {
      return `Online payments must be at least ${formatMoney(MIN_CHECKOUT_CENTS)}.`
    }
    return ''
  }
  if (method.value === 'cash' && receivedCents.value !== null) {
    if (Number.isNaN(receivedCents.value)) return 'Cash received must be an amount like 200.00.'
    if (receivedCents.value < cents) return 'Cash received is less than the amount paid.'
  }
  if (!paidDate.value) return 'Choose the payment date.'
  if (paidDate.value > toIsoDate()) return 'The payment date cannot be in the future.'
  return ''
}

async function startOnline() {
  saving.value = true
  try {
    if (!isCheckoutMethod(method.value)) return
    checkout.value = await openSaleCheckout(props.sale.id, { method: method.value, amountCents: amountCents.value! })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not open the online payment'
  } finally {
    saving.value = false
  }
}

/** The sale as it is now, for the page behind (after an online payment, or after giving up waiting) */
async function finishOnline() {
  checkout.value = null
  try {
    emit('saved', await getSale(props.sale.id))
  } catch {
    emit('close')
  }
}

function onlineCancelled() {
  checkout.value = null
  error.value = 'The online payment was cancelled. Try again, or record a payment made another way.'
}

async function save() {
  error.value = validate()
  if (error.value) return
  if (online.value) return startOnline()
  saving.value = true
  try {
    const sale = await addSalePayment(props.sale.id, {
      amountCents: amountCents.value!,
      method: method.value,
      tenderedCents: method.value === 'cash' ? receivedCents.value : null,
      reference: reference.value.trim() || null,
      note: note.value.trim() || null,
      paidDate: paidDate.value,
    })
    emit('saved', sale)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not record the payment'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <OnlineCheckoutModal
    v-if="checkout"
    :checkout="checkout"
    :sale-reference="sale.reference"
    @paid="finishOnline"
    @cancelled="onlineCancelled"
    @close="finishOnline"
  />
  <AppModal v-else :title="`Record Payment · ${sale.reference}`" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <div class="due-box mb-3">
          <div class="min-w-0">
            <div class="fs-12 text-gray-5">Customer</div>
            <div class="fw-medium text-gray-9 text-truncate">{{ sale.customer.name }}</div>
          </div>
          <div class="text-end">
            <div class="fs-12 text-gray-5">Balance due</div>
            <div class="fw-bold text-danger">{{ formatMoney(sale.dueCents) }}</div>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-sm-6">
            <label class="form-label" for="payment-amount">Amount <span class="text-danger">*</span></label>
            <div class="input-group">
              <span class="input-group-text">{{ currencySymbol() }}</span>
              <input id="payment-amount" v-model="amount" type="text" class="form-control" inputmode="decimal" />
            </div>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="payment-method">Method <span class="text-danger">*</span></label>
            <select id="payment-method" v-model="method" class="form-select">
              <option v-for="m in PAYMENT_METHODS" :key="m" :value="m">{{ paymentMethodLabel(m) }}</option>
            </select>
            <PaymentLogos :method="method" :height="20" class="mt-2" />
          </div>
          <div v-if="method === 'cash'" class="col-sm-6">
            <label class="form-label" for="payment-received">
              Cash received <span class="text-gray-5 fw-normal">(optional)</span>
            </label>
            <div class="input-group">
              <span class="input-group-text">{{ currencySymbol() }}</span>
              <input id="payment-received" v-model="received" type="text" class="form-control" inputmode="decimal" />
            </div>
            <div v-if="changeCents !== null && changeCents >= 0" class="form-text">
              Change: <strong class="text-gray-9">{{ formatMoney(changeCents) }}</strong>
            </div>
          </div>
          <div v-if="canPayOnline" class="col-12">
            <div class="btn-group w-100" role="radiogroup" aria-label="How it's paid">
              <button
                type="button"
                role="radio"
                class="btn"
                :class="payOnline ? 'btn-primary' : 'btn-white border'"
                :aria-checked="payOnline"
                @click="payOnline = true"
              >
                <i class="ti ti-qrcode me-1"></i>Pay online now
              </button>
              <button
                type="button"
                role="radio"
                class="btn"
                :class="!payOnline ? 'btn-primary' : 'btn-white border'"
                :aria-checked="!payOnline"
                @click="payOnline = false"
              >
                <i class="ti ti-receipt me-1"></i>Already paid
              </button>
            </div>
            <div v-if="online" class="form-text">
              The customer pays on PayMongo's page: they scan a QR code with their phone, or you open the page here.
              <div class="mt-1"><SecuredByPaymongo /></div>
            </div>
          </div>
          <div v-if="method !== 'cash' && !online" class="col-sm-6">
            <label class="form-label" for="payment-reference">Reference no.</label>
            <input
              id="payment-reference"
              v-model="reference"
              type="text"
              class="form-control"
              maxlength="50"
              placeholder="e.g. GCash ref. no."
            />
          </div>
          <div v-if="!online" class="col-sm-6">
            <label class="form-label" for="payment-date">Date <span class="text-danger">*</span></label>
            <input id="payment-date" v-model="paidDate" type="date" class="form-control" :max="toIsoDate()" />
          </div>
          <div v-if="serviceChargeCents > 0" class="col-12">
            <div class="alert alert-light border py-2 mb-0 fs-14 d-flex flex-wrap justify-content-between gap-2">
              <span>
                Service charge ({{ paymentMethodLabel(method) }} · {{ chargeRateLabel(charge!) }}): <strong>{{ formatMoney(serviceChargeCents) }}</strong>
              </span>
              <span>
                {{ online ? 'The customer pays' : 'Total to collect' }}: <strong class="text-gray-9">{{ formatMoney(amountCents! + serviceChargeCents) }}</strong>
              </span>
            </div>
          </div>
        </div>

        <div v-if="!online">
          <label class="form-label" for="payment-note">Note <span class="text-gray-5 fw-normal">(optional)</span></label>
          <textarea id="payment-note" v-model="note" class="form-control" rows="2" maxlength="500"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : online ? 'Pay Online' : 'Record Payment' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.due-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f9fafb;
}

.min-w-0 {
  min-width: 0;
}
</style>
