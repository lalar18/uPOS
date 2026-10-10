<script setup lang="ts">
// Sets the service charges: on renewals paid online, on store sale payments by online methods, and
// on store withdrawals (kept out of the amount sent). Each is a fixed amount or a percentage.
import { ref } from 'vue'
import { PAYMENT_METHODS, paymentMethodLabel } from '@/api/sales'
import type { ChargeKind, ServiceCharge } from '@/api/serviceCharge'
import { updateServiceCharges, type ServiceCharges } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { centsToText, parsePercentBp, parsePeso } from '@/utils/money'

const props = defineProps<{ charges: ServiceCharges }>()
const emit = defineEmits<{ close: []; saved: [charges: ServiceCharges] }>()

/** Keep in step with ONLINE_METHODS in worker/serviceCharges.ts */
const ONLINE_METHODS = PAYMENT_METHODS.filter((m) => m !== 'cash')
const MAX_FIXED_CENTS = 1_000_000 // keep in step with worker/usPanel/income.ts

interface ChargeForm {
  kind: ChargeKind
  text: string // pesos ("10.00") or percent ("2.5")
  methods: string[]
}

const toForm = (charge: ServiceCharge): ChargeForm => ({
  kind: charge.kind,
  text: charge.kind === 'fixed' ? centsToText(charge.value) : String(charge.value / 100),
  methods: [...charge.methods],
})

const renewal = ref(toForm(props.charges.renewal))
const sale = ref(toForm(props.charges.sale))
const payout = ref(toForm(props.charges.payout))
const error = ref('')
const saving = ref(false)

/** The form as a charge, or an error message */
function readForm(form: ChargeForm, label: string): ServiceCharge | string {
  if (form.kind === 'percent') {
    const bp = parsePercentBp(form.text)
    return Number.isNaN(bp) ? `The ${label} charge must be a percentage from 0 to 100, like 2.5.` : { ...form, value: bp }
  }
  const cents = parsePeso(form.text) ?? 0
  if (Number.isNaN(cents) || cents > MAX_FIXED_CENTS) return `The ${label} charge must be an amount up to ₱10,000, like 10.00.`
  return { ...form, value: cents }
}

async function save() {
  error.value = ''
  const renewalCharge = readForm(renewal.value, 'renewal')
  if (typeof renewalCharge === 'string') return void (error.value = renewalCharge)
  const saleCharge = readForm(sale.value, 'sale')
  if (typeof saleCharge === 'string') return void (error.value = saleCharge)
  if (saleCharge.value > 0 && saleCharge.methods.length === 0) {
    return void (error.value = 'Choose the payment methods the sale charge applies to.')
  }
  const payoutCharge = readForm(payout.value, 'withdrawal')
  if (typeof payoutCharge === 'string') return void (error.value = payoutCharge)

  saving.value = true
  try {
    emit(
      'saved',
      await updateServiceCharges({
        renewal: { ...renewalCharge, methods: [] },
        sale: saleCharge,
        payout: { ...payoutCharge, methods: [] },
      }),
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the service charges'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Service Charges" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <template v-for="section in [
          { key: 'renewal', form: renewal, title: 'Subscription renewals', hint: 'Added to a renewal paid online through PayMongo. Rounded to whole pesos.' },
          { key: 'sale', form: sale, title: 'Store sale payments', hint: 'Added on top of a sale payment made with one of the methods below. The cashier collects it from the customer.' },
          { key: 'payout', form: payout, title: 'Store withdrawals', hint: 'Kept out of each withdrawal from a store\'s wallet; the store receives the rest. Shown to the store before it asks.' },
        ]" :key="section.key">
          <h6 class="mb-1">{{ section.title }}</h6>
          <p class="fs-13 text-gray-5 mb-2">{{ section.hint }}</p>
          <div class="row g-2 mb-2">
            <div class="col-sm-6">
              <select v-model="section.form.kind" class="form-select" :aria-label="`${section.title}: charge type`">
                <option value="fixed">Fixed amount</option>
                <option value="percent">Percentage of the payment</option>
              </select>
            </div>
            <div class="col-sm-6">
              <div class="input-group">
                <span v-if="section.form.kind === 'fixed'" class="input-group-text">₱</span>
                <input
                  v-model="section.form.text"
                  type="text"
                  inputmode="decimal"
                  class="form-control"
                  :placeholder="section.form.kind === 'fixed' ? '0.00' : '0'"
                  :aria-label="`${section.title}: charge`"
                />
                <span v-if="section.form.kind === 'percent'" class="input-group-text">%</span>
              </div>
            </div>
          </div>
          <div v-if="section.key === 'sale'" class="d-flex flex-wrap gap-3 mb-1">
            <label v-for="m in ONLINE_METHODS" :key="m" class="form-check mb-0">
              <input v-model="section.form.methods" type="checkbox" class="form-check-input" :value="m" />
              <span class="form-check-label">{{ paymentMethodLabel(m) }}</span>
            </label>
          </div>
          <hr v-if="section.key !== 'payout'" class="my-3" />
        </template>

        <p class="fs-13 text-gray-5 mt-3 mb-0">
          Leave a charge at 0 to turn it off. Stores see the charge only on the payment or withdrawal they're making,
          never their totals.
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppModal>
</template>
