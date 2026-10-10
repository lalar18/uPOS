<script setup lang="ts">
// Asks to withdraw from the store's wallet to a GCash number or a bank account. The platform
// sends the money and marks the request sent; until then the amount is held.
import { ref } from 'vue'
import { requestWithdrawal, type Wallet, type WithdrawalDestination } from '@/api/store'
import AppModal from '@/components/AppModal.vue'
import { centsToText, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{ wallet: Wallet }>()
const emit = defineEmits<{ close: []; saved: [wallet: Wallet] }>()

// Starts from where the last withdrawal went
const last = props.wallet.withdrawals[0]
const destination = ref<WithdrawalDestination>(last?.destination ?? 'gcash')
const bankName = ref(last?.bankName ?? '')
const accountName = ref(last?.accountName ?? '')
const accountNumber = ref(last?.accountNumber ?? '')
const amount = ref(centsToText(props.wallet.availableCents))
const note = ref('')
const error = ref('')
const saving = ref(false)

const peso = (cents: number) => formatMoney(cents, 'PHP')

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
  if (destination.value === 'bank' && !bankName.value.trim()) {
    error.value = 'Enter the bank name.'
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
      bankName: destination.value === 'bank' ? bankName.value : '',
      accountName: accountName.value,
      accountNumber: accountNumber.value,
      note: note.value,
    })
    emit('saved', wallet)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not send the withdrawal request'
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
            <input
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
          Check the name and number: the money is sent exactly where you say. The amount is held until it's sent.
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
</style>
