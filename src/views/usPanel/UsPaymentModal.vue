<script setup lang="ts">
// Records a subscription payment. With `renewal`, confirms a store's pending request;
// with `store`, records a payment the store made without one. Either way the store is
// extended by the months paid for (from its expiry, or from today if it already expired).
import { computed, ref, watch } from 'vue'
import { PAYMENT_METHODS, paymentMethodLabel } from '@/api/sales'
import { formatDate, formatPrice, type Plan } from '@/api/subscription'
import { MAX_PAID_MONTHS, payRenewal, recordStorePayment, type Renewal } from '@/api/usPanel'
import { parseDbDate } from '@/api/http'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{
  renewal?: Renewal // a pending renewal to confirm
  store?: { id: number; name: string; planId: string } // or a store to record a payment for
  plans?: Plan[] // needed with `store`
  expiresAt?: string | null // the store's current expiry, to preview the new one
}>()
const emit = defineEmits<{ close: []; saved: [renewal: Renewal] }>()

const storeName = computed(() => props.renewal?.store.name ?? props.store?.name ?? '')
const planId = ref(props.renewal?.plan.id ?? props.store?.planId ?? '')
const plan = computed(() =>
  props.renewal ? props.renewal.plan : props.plans?.find((p) => p.id === planId.value),
)

const months = ref(props.renewal?.months ?? 1)
const amount = ref<number | ''>('')
const amountEdited = ref(false) // until typed in, the amount follows plan price × months
const paymentMethod = ref<string>('bank_transfer')
const reference = ref('')
const note = ref('')
const error = ref('')
const saving = ref(false)

watch(
  [plan, months],
  () => {
    if (!amountEdited.value && plan.value) amount.value = plan.value.monthlyPrice * (months.value || 0)
  },
  { immediate: true },
)

/** What the store's expiry becomes: months added to its expiry, or to now if that passed */
const newExpiry = computed(() => {
  if (props.expiresAt === undefined || !Number.isInteger(months.value) || months.value < 1) return null
  const now = new Date()
  const current = props.expiresAt ? parseDbDate(props.expiresAt) : now
  const start = current > now ? current : now
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + months.value)
  return end
})

async function save() {
  error.value = ''
  if (!Number.isInteger(months.value) || months.value < 1 || months.value > MAX_PAID_MONTHS) {
    error.value = `Months must be between 1 and ${MAX_PAID_MONTHS}.`
    return
  }
  if (amount.value === '' || !Number.isInteger(amount.value) || amount.value < 0) {
    error.value = 'Enter the amount received, in whole pesos.'
    return
  }
  if (!plan.value) {
    error.value = 'Choose a plan.'
    return
  }
  const input = {
    months: months.value,
    amount: amount.value,
    paymentMethod: paymentMethod.value,
    reference: reference.value,
    note: note.value,
  }
  saving.value = true
  try {
    const saved = props.renewal
      ? await payRenewal(props.renewal.id, input)
      : await recordStorePayment(props.store!.id, { ...input, planId: planId.value })
    emit('saved', saved)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not record the payment'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="renewal ? 'Confirm Payment' : 'Record Payment'" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <p class="mb-3">
          <template v-if="renewal">
            <strong class="text-break">{{ storeName }}</strong> asked to renew on the
            <strong>{{ renewal.plan.name }}</strong> plan
            <template v-if="renewal.requestedBy">({{ renewal.requestedBy }}, {{ formatDate(renewal.createdAt) }})</template>.
          </template>
          <template v-else>
            Payment from <strong class="text-break">{{ storeName }}</strong>.
          </template>
        </p>

        <div class="row g-3">
          <div v-if="!renewal" class="col-sm-6">
            <label class="form-label" for="pay-plan">Plan <span class="text-danger">*</span></label>
            <select id="pay-plan" v-model="planId" class="form-select">
              <option v-for="p in plans" :key="p.id" :value="p.id">
                {{ p.name }} · {{ formatPrice(p.monthlyPrice) }}/mo
              </option>
            </select>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="pay-months">Months paid <span class="text-danger">*</span></label>
            <input
              id="pay-months"
              v-model.number="months"
              type="number"
              min="1"
              :max="MAX_PAID_MONTHS"
              step="1"
              class="form-control"
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="pay-amount">Amount received (₱) <span class="text-danger">*</span></label>
            <input
              id="pay-amount"
              v-model.number="amount"
              type="number"
              min="0"
              step="1"
              class="form-control"
              @input="amountEdited = true"
            />
            <div v-if="plan" class="form-text">
              {{ formatPrice(plan.monthlyPrice) }} × {{ months || 0 }} = {{ formatPrice(plan.monthlyPrice * (months || 0)) }}
            </div>
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="pay-method">Payment method <span class="text-danger">*</span></label>
            <select id="pay-method" v-model="paymentMethod" class="form-select">
              <option v-for="m in PAYMENT_METHODS" :key="m" :value="m">{{ paymentMethodLabel(m) }}</option>
            </select>
          </div>
          <div class="col-12">
            <label class="form-label" for="pay-reference">Reference no.</label>
            <input
              id="pay-reference"
              v-model="reference"
              type="text"
              maxlength="50"
              class="form-control"
              placeholder="e.g. bank or GCash reference"
            />
          </div>
          <div class="col-12">
            <label class="form-label" for="pay-note">Note</label>
            <textarea id="pay-note" v-model="note" rows="2" maxlength="500" class="form-control"></textarea>
          </div>
        </div>

        <div v-if="newExpiry" class="alert alert-light border py-2 mt-3 mb-0 fs-14" role="status">
          <i class="ti ti-calendar-event me-1 text-primary"></i>
          The subscription will run until about
          <strong>{{ newExpiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</strong>.
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : renewal ? 'Confirm Payment' : 'Record Payment' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
