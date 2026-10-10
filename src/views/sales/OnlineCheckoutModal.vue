<script setup lang="ts">
// Waits for an online payment (PayMongo) of a sale. The customer scans the QR code with their
// phone, or the cashier opens the payment page on this device for them. The dialog keeps
// asking the server, which checks PayMongo, until it's paid; then it emits `paid`.
// Cancelling closes the payment page, so it can't be paid later; closing just stops waiting
// (a payment made afterwards is still recorded on the sale).
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, ref } from 'vue'
import { cancelSaleCheckout, getSaleCheckout, paymentMethodLabel, type SaleCheckout } from '@/api/sales'
import AppModal from '@/components/AppModal.vue'
import PaymentLogos from '@/components/PaymentLogos.vue'
import SecuredByPaymongo from '@/components/SecuredByPaymongo.vue'
import { formatMoney } from '@/utils/money'

const props = defineProps<{ checkout: SaleCheckout; saleReference: string }>()
const emit = defineEmits<{ close: []; paid: [checkout: SaleCheckout]; cancelled: [checkout: SaleCheckout] }>()

const POLL_MS = 3000

const current = ref<SaleCheckout>(props.checkout)
const qrSvg = ref('')
const cancelling = ref(false)
const error = ref('')

if (props.checkout.checkoutUrl) {
  QRCode.toString(props.checkout.checkoutUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    .then((svg) => (qrSvg.value = svg))
    .catch(() => (qrSvg.value = ''))
}

const refundDue = computed(() => current.value.status === 'refund_due')

/** Where the payment page is (checkout.paymongo.com), for the customer to check before paying */
const pageHost = computed(() => {
  try {
    return current.value.checkoutUrl ? new URL(current.value.checkoutUrl).host : ''
  } catch {
    return ''
  }
})

function settle(checkout: SaleCheckout) {
  current.value = checkout
  if (checkout.status === 'paid') emit('paid', checkout)
  else if (checkout.status === 'cancelled') emit('cancelled', checkout)
  // refund_due stays open, to explain it
  return checkout.status !== 'pending'
}

let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false

async function poll() {
  try {
    const checkout = await getSaleCheckout(current.value.saleId, current.value.id)
    error.value = ''
    if (settle(checkout)) return
  } catch {
    error.value = 'Lost touch with the server. Still trying…'
  }
  if (!stopped) timer = setTimeout(poll, POLL_MS)
}
timer = setTimeout(poll, POLL_MS)

onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})

function openPage() {
  if (current.value.checkoutUrl) window.open(current.value.checkoutUrl, '_blank', 'noopener')
}

async function cancel() {
  cancelling.value = true
  error.value = ''
  stopped = true
  clearTimeout(timer)
  try {
    settle(await cancelSaleCheckout(current.value.saleId, current.value.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not cancel the online payment'
    stopped = false
    timer = setTimeout(poll, POLL_MS)
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <AppModal :title="`Online Payment · ${saleReference}`" size="sm" @close="emit('close')">
    <div class="modal-body text-center">
      <template v-if="refundDue">
        <div class="alert alert-warning text-start mb-0" role="alert">
          The customer paid {{ formatMoney(current.totalCents) }} online, but this sale was already paid another way.
          The online payment wasn't added to the sale. Ask the platform administrator to refund the customer.
        </div>
      </template>
      <template v-else>
        <PaymentLogos :method="current.method" :height="32" class="mb-2" />
        <div class="fs-13 text-gray-5">Pay with {{ paymentMethodLabel(current.method) }} · total to pay</div>
        <div class="total-amount">{{ formatMoney(current.totalCents) }}</div>
        <div v-if="current.serviceChargeCents > 0" class="fs-13 text-gray-5 mb-2">
          {{ formatMoney(current.amountCents) }} + {{ formatMoney(current.serviceChargeCents) }} service charge
        </div>

        <!-- SVG made by the qrcode library from the payment page URL -->
        <div v-if="qrSvg" class="qr mx-auto my-3" role="img" aria-label="QR code of the payment page" v-html="qrSvg"></div>
        <p class="fs-14 mb-1">Ask the customer to scan the code with their phone camera, or open the payment page here.</p>
        <p v-if="pageHost" class="fs-12 text-gray-5 mb-2">
          The payment page is PayMongo's, at <strong class="text-gray-9">{{ pageHost }}</strong>
        </p>
        <button type="button" class="btn btn-white border mb-3" :disabled="!current.checkoutUrl" @click="openPage">
          <i class="ti ti-external-link me-1"></i>Open payment page
        </button>

        <div class="waiting fs-14" role="status">
          <span class="spinner-border spinner-border-sm text-primary me-2" aria-hidden="true"></span>
          Waiting for the payment…
        </div>
        <div class="mt-2">
          <SecuredByPaymongo />
        </div>
      </template>
      <div v-if="error" class="alert alert-danger py-2 mt-3 mb-0 text-start" role="alert">{{ error }}</div>
    </div>
    <div class="modal-footer">
      <template v-if="refundDue">
        <button type="button" class="btn btn-primary" @click="emit('close')">Close</button>
      </template>
      <template v-else>
        <button type="button" class="btn btn-white border" :disabled="cancelling" @click="emit('close')">
          Close
        </button>
        <button type="button" class="btn btn-danger" :disabled="cancelling" @click="cancel">
          {{ cancelling ? 'Cancelling…' : 'Cancel Online Payment' }}
        </button>
      </template>
    </div>
  </AppModal>
</template>

<style scoped>
.total-amount {
  color: #212b36;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.qr {
  width: 220px;
  max-width: 100%;
}

.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f9fafb;
}
</style>
