<script setup lang="ts">
// The POS "Pay" dialog. Cash shows quick amounts and the change; other methods take a
// reference number. A named customer can pay part now or charge it all to their account;
// a walk-in customer must pay in full. The parent saves the sale and passes back errors.
import { computed, ref } from 'vue'
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentInput, type PaymentMethod } from '@/api/sales'
import AppModal from '@/components/AppModal.vue'
import { centsToText, currencySymbol, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{
  totalCents: number
  customerName: string | null // null for a walk-in customer
  saving: boolean
  error: string
}>()
const emit = defineEmits<{ close: []; confirm: [payments: PaymentInput[]] }>()

const METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: 'cash',
  card: 'credit-card',
  gcash: 'wallet',
  maya: 'wallet',
  bank_transfer: 'building-bank',
  cheque: 'file-dollar',
  other: 'dots',
}

const method = ref<PaymentMethod>('cash')
const receivedText = ref('') // cash handed over
const amountText = ref(centsToText(props.totalCents)) // other methods
const reference = ref('')
const localError = ref('')

const canPayLater = computed(() => props.customerName !== null)

/** Bills a customer is likely to hand over: the exact amount, then the next round amounts above it */
const quickAmounts = computed(() => {
  const total = props.totalCents
  const amounts = new Set<number>([total])
  for (const step of [2000, 5000, 10000, 50000, 100000]) {
    const rounded = Math.ceil(total / step) * step
    if (rounded > total) amounts.add(rounded)
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 5)
})

const receivedCents = computed(() => parsePeso(receivedText.value))
const changeCents = computed(() => {
  const given = receivedCents.value
  return given === null || Number.isNaN(given) ? null : given - props.totalCents
})

function pickMethod(value: PaymentMethod) {
  method.value = value
  localError.value = ''
}

function confirm() {
  localError.value = ''
  const total = props.totalCents
  if (total === 0) {
    emit('confirm', [])
    return
  }

  if (method.value === 'cash') {
    const given = receivedCents.value ?? total // blank means exact cash
    if (Number.isNaN(given) || given <= 0) {
      localError.value = 'Enter the cash received, like 500.00.'
      return
    }
    if (given < total && !canPayLater.value) {
      localError.value = `Cash received is ${formatMoney(total - given)} short. Walk-in sales must be paid in full.`
      return
    }
    const amount = Math.min(given, total) // less than the total leaves a balance on the customer's account
    emit('confirm', [{ amountCents: amount, method: 'cash', tenderedCents: given, reference: null }])
    return
  }

  const amount = canPayLater.value ? parsePeso(amountText.value) : total
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    localError.value = 'Enter the amount paid, like 150.00.'
    return
  }
  if (amount > total) {
    localError.value = 'The amount is more than the total.'
    return
  }
  emit('confirm', [{ amountCents: amount, method: method.value, reference: reference.value.trim() || null }])
}

function payLater() {
  localError.value = ''
  emit('confirm', [])
}
</script>

<template>
  <AppModal title="Payment" @close="emit('close')">
    <form novalidate @submit.prevent="confirm">
      <div class="modal-body">
        <div class="total-box mb-3">
          <div class="fs-13 text-gray-5">Amount to pay</div>
          <div class="total-amount">{{ formatMoney(totalCents) }}</div>
          <div class="fs-13 text-gray-5">{{ customerName ?? 'Walk-in Customer' }}</div>
        </div>

        <div v-if="error || localError" class="alert alert-danger py-2" role="alert">{{ localError || error }}</div>

        <div class="method-grid mb-3" role="radiogroup" aria-label="Payment method">
          <button
            v-for="m in PAYMENT_METHODS"
            :key="m"
            type="button"
            role="radio"
            :aria-checked="method === m"
            :class="{ active: method === m }"
            @click="pickMethod(m)"
          >
            <i class="ti" :class="`ti-${METHOD_ICONS[m]}`"></i>
            <span>{{ paymentMethodLabel(m) }}</span>
          </button>
        </div>

        <template v-if="method === 'cash'">
          <label class="form-label" for="pos-received">Cash received</label>
          <div class="input-group input-group-lg mb-2">
            <span class="input-group-text">{{ currencySymbol() }}</span>
            <input
              id="pos-received"
              v-model="receivedText"
              type="text"
              class="form-control"
              inputmode="decimal"
              :placeholder="centsToText(totalCents)"
              autofocus
            />
          </div>
          <div class="quick-amounts mb-2">
            <button
              v-for="amount in quickAmounts"
              :key="amount"
              type="button"
              class="btn btn-sm btn-white border"
              @click="receivedText = centsToText(amount)"
            >
              {{ amount === totalCents ? 'Exact' : formatMoney(amount) }}
            </button>
          </div>
          <div v-if="changeCents !== null" class="change-row" :class="changeCents < 0 ? 'text-danger' : 'text-success'">
            <span>{{ changeCents < 0 ? (canPayLater ? 'Left on account' : 'Short by') : 'Change' }}</span>
            <span>{{ formatMoney(Math.abs(changeCents)) }}</span>
          </div>
        </template>

        <template v-else>
          <div class="row g-2">
            <div v-if="canPayLater" class="col-sm-6">
              <label class="form-label" for="pos-amount">Amount paid</label>
              <div class="input-group">
                <span class="input-group-text">{{ currencySymbol() }}</span>
                <input id="pos-amount" v-model="amountText" type="text" class="form-control" inputmode="decimal" />
              </div>
            </div>
            <div :class="canPayLater ? 'col-sm-6' : 'col-12'">
              <label class="form-label" for="pos-reference">Reference no. <span class="text-gray-5 fw-normal">(optional)</span></label>
              <input
                id="pos-reference"
                v-model="reference"
                type="text"
                class="form-control"
                maxlength="50"
                placeholder="e.g. GCash ref. no."
              />
            </div>
          </div>
        </template>
      </div>
      <div class="modal-footer flex-wrap">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button v-if="canPayLater" type="button" class="btn btn-white border" :disabled="saving" @click="payLater">
          Charge to Account
        </button>
        <button type="submit" class="btn btn-success flex-grow-1" :disabled="saving">
          <i class="ti ti-check me-1"></i>{{ saving ? 'Saving…' : 'Complete Sale' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.total-box {
  padding: 14px;
  border-radius: 8px;
  background: #fff6ee;
  text-align: center;
}

.total-amount {
  color: #212b36;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.method-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.method-grid button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #646b72;
  font-size: 12px;
  font-weight: 500;
}

.method-grid button i {
  font-size: 18px;
}

.method-grid button.active {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

.quick-amounts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.change-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f9fafb;
  font-size: 18px;
  font-weight: 700;
}

@media (max-width: 379.98px) {
  .method-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
