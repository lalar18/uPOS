<script setup lang="ts">
// Asks to withdraw from the store's wallet to a GCash number or a bank account. The platform
// sends the money (through PayMongo, to a bank from its list) and the request shows as sent; until
// then the amount is held. Any service charge is kept out of the amount, so the dialog shows what
// the store will receive before it asks.
import { computed, ref } from 'vue'
import { chargeRateLabel, payoutChargeCents } from '@/api/serviceCharge'
import { getWallet, getWithdrawalBanks, requestWithdrawal, type Bank, type Wallet, type WithdrawalDestination } from '@/api/store'
import AppModal from '@/components/AppModal.vue'
import { centsToText, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{ wallet: Wallet }>()
const emit = defineEmits<{ close: []; saved: [wallet: Wallet] }>()

// Starts from where the last withdrawal went
const last = props.wallet.withdrawals[0]
const destination = ref<WithdrawalDestination>(last?.destination ?? 'gcash')
const bankCode = ref(last?.destination === 'bank' ? (last.bankCode ?? '') : '')
const bankName = ref(last?.bankName ?? '')
// PayMongo's banks; null: there's no list, so the bank name is typed in
const banks = ref<Bank[] | null>(null)
const banksLoading = ref(true)
getWithdrawalBanks()
  .then((list) => {
    banks.value = list
    if (list && !list.some((b) => b.code === bankCode.value)) bankCode.value = ''
  })
  .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the list of banks'))
  .finally(() => (banksLoading.value = false))
const accountName = ref(last?.accountName ?? '')
const accountNumber = ref(last?.accountNumber ?? '')
const amount = ref(centsToText(props.wallet.availableCents))
const note = ref('')
const error = ref('')
const saving = ref(false)

const peso = (cents: number) => formatMoney(cents, 'PHP')

// The service charge rate (reloaded if it changed while the dialog was open)
const rate = ref(props.wallet.withdrawalCharge)
const hasCharge = computed(() => rate.value.value > 0)
/** The amount typed in, or null while it isn't a valid one */
const amountCents = computed(() => {
  const cents = parsePeso(amount.value)
  return cents === null || Number.isNaN(cents) || cents <= 0 ? null : cents
})
const charge = computed(() => (amountCents.value ? payoutChargeCents(rate.value, amountCents.value) : 0))
const receive = computed(() => (amountCents.value ?? 0) - charge.value)

function pick(value: WithdrawalDestination) {
  if (value === destination.value) return
  destination.value = value
  accountNumber.value = '' // a GCash number isn't a bank account number
}

async function save() {
  error.value = ''
  const cents = parsePeso(amount.value)
  if (cents === null || Number.isNaN(cents) || cents <= 0) {
    error.value = 'Enter the amount to withdraw, like 1500.00.'
    return
  }
  if (cents > props.wallet.availableCents) {
    error.value = `You can withdraw up to ${peso(props.wallet.availableCents)}.`
    return
  }
  if (destination.value === 'bank' && (banks.value ? !bankCode.value : !bankName.value.trim())) {
    error.value = banks.value ? 'Choose your bank.' : 'Enter the bank name.'
    return
  }
  if (!accountName.value.trim() || !accountNumber.value.trim()) {
    error.value = destination.value === 'gcash' ? 'Enter the GCash name and number.' : 'Enter the account name and number.'
    return
  }
  saving.value = true
  try {
    const wallet = await requestWithdrawal({
      amountCents: cents,
      destination: destination.value,
      bankCode: destination.value === 'bank' && banks.value ? bankCode.value : '',
      bankName: destination.value === 'bank' && !banks.value ? bankName.value : '',
      accountName: accountName.value,
      accountNumber: accountNumber.value,
      note: note.value,
      serviceChargeCents: payoutChargeCents(rate.value, cents),
    })
    emit('saved', wallet)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not send the withdrawal request'
    // The rate may have changed: show the current one, so asking again sends what's on screen
    getWallet()
      .then((current) => (rate.value = current.withdrawalCharge))
      .catch(() => {})
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Withdraw" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <div class="available mb-3">
          <div class="fs-12 text-gray-5">Available to withdraw</div>
          <div class="fs-20 fw-bold text-gray-9">{{ peso(wallet.availableCents) }}</div>
        </div>

        <div class="mb-3">
          <label class="form-label" for="withdraw-amount">Amount (₱) <span class="text-danger">*</span></label>
          <input id="withdraw-amount" v-model="amount" type="text" inputmode="decimal" class="form-control" />
        </div>

        <!-- What the store gets once the service charge is kept out -->
        <div class="breakdown mb-3" aria-live="polite">
          <div class="d-flex justify-content-between gap-2">
            <span class="text-gray-5">Withdrawal amount</span>
            <span>{{ peso(amountCents ?? 0) }}</span>
          </div>
          <div class="d-flex justify-content-between gap-2">
            <span class="text-gray-5">
              Service charge
              <span v-if="hasCharge" class="fs-12">({{ chargeRateLabel(rate) }})</span>
            </span>
            <span :class="{ 'text-danger': charge }">{{ charge ? `−${peso(charge)}` : peso(0) }}</span>
          </div>
          <div class="d-flex justify-content-between gap-2 total">
            <span class="fw-semibold text-gray-9">You'll receive</span>
            <span class="fw-bold text-gray-9">{{ peso(receive) }}</span>
          </div>
        </div>

        <label class="form-label">Send to <span class="text-danger">*</span></label>
        <div class="btn-group w-100 mb-3" role="group">
          <button
            type="button"
            class="btn"
            :class="destination === 'gcash' ? 'btn-primary' : 'btn-white border'"
            :aria-pressed="destination === 'gcash'"
            @click="pick('gcash')"
          >
            <i class="ti ti-device-mobile me-1"></i>GCash
          </button>
          <button
            type="button"
            class="btn"
            :class="destination === 'bank' ? 'btn-primary' : 'btn-white border'"
            :aria-pressed="destination === 'bank'"
            @click="pick('bank')"
          >
            <i class="ti ti-building-bank me-1"></i>Bank account
          </button>
        </div>

        <div class="row g-3">
          <div v-if="destination === 'bank'" class="col-12">
            <label class="form-label" for="withdraw-bank">Bank <span class="text-danger">*</span></label>
            <select v-if="banks" id="withdraw-bank" v-model="bankCode" class="form-select">
              <option value="" disabled>Choose your bank or e-wallet</option>
              <option v-for="b in banks" :key="b.code" :value="b.code">{{ b.name }}</option>
            </select>
            <select v-else-if="banksLoading" id="withdraw-bank" class="form-select" disabled>
              <option>Loading banks…</option>
            </select>
            <input
              v-else
              id="withdraw-bank"
              v-model="bankName"
              type="text"
              maxlength="100"
              class="form-control"
              placeholder="e.g. BDO, BPI, Metrobank"
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="withdraw-name">
              {{ destination === 'gcash' ? 'GCash name' : 'Account name' }} <span class="text-danger">*</span>
            </label>
            <input id="withdraw-name" v-model="accountName" type="text" maxlength="100" class="form-control" autocomplete="name" />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="withdraw-number">
              {{ destination === 'gcash' ? 'GCash number' : 'Account number' }} <span class="text-danger">*</span>
            </label>
            <input
              id="withdraw-number"
              v-model="accountNumber"
              type="text"
              inputmode="numeric"
              maxlength="30"
              class="form-control"
              :placeholder="destination === 'gcash' ? '0917 123 4567' : ''"
            />
          </div>
          <div class="col-12">
            <label class="form-label" for="withdraw-note">Note</label>
            <textarea id="withdraw-note" v-model="note" rows="2" maxlength="500" class="form-control"></textarea>
          </div>
        </div>
        <p class="fs-12 text-gray-5 mt-3 mb-0">
          Check the name and number: they must match the account exactly, or the transfer fails. The amount is held
          until it's sent<template v-if="hasCharge">, and the service charge is kept out of it</template>.
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Sending…' : 'Request Withdrawal' }}</button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.available {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f9fafb;
}

.breakdown {
  padding: 10px 12px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  font-size: 14px;
}

.breakdown > div + div {
  margin-top: 4px;
}

.breakdown .total {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #c7ccd1;
}
</style>
