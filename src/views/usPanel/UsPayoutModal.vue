<script setup lang="ts">
// A store's wallet: what it's owed, the withdrawal it asked for (send it through PayMongo, mark it
// sent by hand, or reject it), recording a payout made without a request, and the history,
// including every transfer sent through PayMongo.
import { computed, ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { PAYMENT_METHODS, paymentMethodLabel } from '@/api/sales'
import { chargeRateLabel } from '@/api/serviceCharge'
import {
  describeDestination,
  TRANSFER_STATUS,
  transferProviderLabel,
  WITHDRAWAL_STATUS,
  type Bank,
  type Wallet,
} from '@/api/store'
import {
  getPayoutBanks,
  getStorePayouts,
  recordPayout,
  rejectWithdrawal,
  sendWithdrawal,
  transferWithdrawal,
} from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { toIsoDate } from '@/utils/date'
import { centsToText, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{ store: { id: number; name: string } }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

/** InstaPay's most per transfer (₱50,000); PayMongo sends more by PESONet */
const INSTAPAY_MAX_CENTS = 50_000_00

const summary = ref<Wallet | null>(null)
const amount = ref('')
const method = ref('bank_transfer')
const reference = ref('')
const paidDate = ref(toIsoDate())
const note = ref('')
// What to do with the pending request: send it through PayMongo, record it as sent by hand, or reject it
const mode = ref<'paymongo' | 'manual' | 'reject'>('paymongo')
const rejectReason = ref('')
// For a bank request made without a bank from PayMongo's list
const banks = ref<Bank[] | null>(null)
const bankCode = ref('')
const error = ref('')
const saving = ref(false)
const checking = ref(false)

const peso = (cents: number) => formatMoney(cents, 'PHP')
const pending = computed(() => summary.value?.pendingWithdrawal ?? null)
const needsBank = computed(() => pending.value?.destination === 'bank' && !pending.value.bankCode)

function show(result: Wallet) {
  summary.value = result
  amount.value = result.availableCents > 0 ? centsToText(result.availableCents) : ''
  if (!result.transfersEnabled && mode.value === 'paymongo') mode.value = 'manual'
  const request = result.pendingWithdrawal
  if (result.transfersEnabled && request?.destination === 'bank' && !request.bankCode && !banks.value) {
    getPayoutBanks()
      .then((list) => (banks.value = list))
      .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the list of banks'))
  }
}

getStorePayouts(props.store.id)
  .then(show)
  .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the payouts'))

/** Asks again how the transfer on its way is going (the server checks with PayMongo) */
async function checkStatus() {
  error.value = ''
  checking.value = true
  const id = pending.value?.id
  try {
    const result = await getStorePayouts(props.store.id)
    const w = result.withdrawals.find((x) => x.id === id)
    if (w?.status === 'sent') {
      emit('saved', `${peso(w.receiveCents)} sent to ${props.store.name} through PayMongo (${w.transfer?.reference}).`)
      return
    }
    show(result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not check the transfer'
  } finally {
    checking.value = false
  }
}

async function sendThroughPaymongo(id: number) {
  if (needsBank.value && !bankCode.value) {
    error.value = "Choose the store's bank."
    return
  }
  saving.value = true
  try {
    const result = await transferWithdrawal(id, needsBank.value ? bankCode.value : null)
    const w = result.withdrawals.find((x) => x.id === id)
    const transfer = w?.transfer
    if (w?.status === 'sent') {
      emit('saved', `${peso(w.receiveCents)} sent to ${props.store.name} through PayMongo (${transfer?.reference}).`)
    } else if (transfer?.status === 'pending') {
      emit(
        'saved',
        `Sending ${peso(transfer.amountCents)} to ${props.store.name} through PayMongo (${transfer.reference}). It shows as sent once PayMongo confirms.`,
      )
    } else {
      show(result)
      error.value = transfer?.failureMessage ?? "PayMongo couldn't send it."
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not send the withdrawal'
    getStorePayouts(props.store.id).then(show).catch(() => {})
  } finally {
    saving.value = false
  }
}

function checkDate(): boolean {
  if (!paidDate.value || paidDate.value > toIsoDate()) {
    error.value = 'Choose the date it was sent (not in the future).'
    return false
  }
  return true
}

async function run(action: () => Promise<Wallet>, message: string, failure: string) {
  saving.value = true
  try {
    await action()
    emit('saved', message)
  } catch (e) {
    error.value = e instanceof Error ? e.message : failure
  } finally {
    saving.value = false
  }
}

async function save() {
  error.value = ''
  const request = pending.value
  if (request) {
    if (request.sending) return
    if (mode.value === 'paymongo') {
      await sendThroughPaymongo(request.id)
      return
    }
    if (mode.value === 'reject') {
      if (!rejectReason.value.trim()) {
        error.value = 'Tell the store why the withdrawal was rejected.'
        return
      }
      await run(() => rejectWithdrawal(request.id, rejectReason.value), `Withdrawal rejected for ${props.store.name}.`, 'Could not reject the withdrawal')
      return
    }
    if (!checkDate()) return
    await run(
      () => sendWithdrawal(request.id, { reference: reference.value, note: note.value, paidDate: paidDate.value }),
      `${peso(request.receiveCents)} marked as sent to ${props.store.name}.`,
      'Could not record the withdrawal',
    )
    return
  }

  const cents = parsePeso(amount.value)
  if (cents === null || Number.isNaN(cents) || cents <= 0) {
    error.value = 'Enter the amount paid out, like 1500.00.'
    return
  }
  if (summary.value && cents > summary.value.availableCents) {
    error.value = `The store is only owed ${peso(summary.value.availableCents)}.`
    return
  }
  if (!checkDate()) return
  await run(
    () =>
      recordPayout(props.store.id, {
        amountCents: cents,
        method: method.value,
        reference: reference.value,
        note: note.value,
        paidDate: paidDate.value,
      }),
    `Payout recorded for ${props.store.name}.`,
    'Could not record the payout',
  )
}

const copied = ref('')
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = value
  } catch {
    // clipboard not allowed (plain http); the value is on screen to copy by hand
  }
}
</script>

<template>
  <AppModal :title="`Payouts · ${store.name}`" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div v-if="!summary && !error" class="text-center text-gray-5 py-4">Loading…</div>

        <template v-if="summary">
          <div class="row g-2 mb-3 text-center">
            <div class="col-4">
              <div class="stat">
                <div class="fs-12 text-gray-5">Paid online</div>
                <div class="fw-bold text-gray-9">{{ peso(summary.collectedCents) }}</div>
              </div>
            </div>
            <div class="col-4">
              <div class="stat">
                <div class="fs-12 text-gray-5">Paid out</div>
                <div class="fw-bold text-gray-9">{{ peso(summary.paidOutCents) }}</div>
              </div>
            </div>
            <div class="col-4">
              <div class="stat">
                <div class="fs-12 text-gray-5">Owed</div>
                <div class="fw-bold" :class="summary.balanceCents > 0 ? 'text-danger' : 'text-success'">
                  {{ peso(summary.balanceCents) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="summary.refundsDue.length" class="alert alert-warning py-2 fs-14" role="alert">
            <div class="fw-medium mb-1">Customers to refund from the PayMongo dashboard</div>
            <div v-for="r in summary.refundsDue" :key="r.id">
              {{ r.sale.reference }} · {{ paymentMethodLabel(r.method) }} · {{ peso(r.paidCents) }}
              <template v-if="r.paymentReference"> · {{ r.paymentReference }}</template>
            </div>
            <div class="fs-12 mt-1">They paid online after the sale was already paid another way.</div>
          </div>

          <!-- The withdrawal the store asked for -->
          <template v-if="pending">
            <h6 class="mb-2">Withdrawal request {{ pending.reference }}</h6>
            <div class="request mb-3">
              <template v-if="pending.serviceChargeCents">
                <div class="d-flex justify-content-between gap-2">
                  <span class="text-gray-5">Withdrawal amount</span>
                  <span class="fw-medium">{{ peso(pending.amountCents) }}</span>
                </div>
                <div class="d-flex justify-content-between gap-2">
                  <span class="text-gray-5">
                    Service charge
                    <span v-if="pending.serviceChargeRate" class="fs-12">({{ chargeRateLabel(pending.serviceChargeRate) }})</span>
                  </span>
                  <span class="fw-medium text-success">{{ peso(pending.serviceChargeCents) }}</span>
                </div>
              </template>
              <div class="d-flex justify-content-between gap-2 mb-2">
                <span class="text-gray-5">{{ pending.serviceChargeCents ? 'Amount to send' : 'Amount' }}</span>
                <span class="fs-18 fw-bold text-gray-9">{{ peso(pending.receiveCents) }}</span>
              </div>
              <div class="d-flex justify-content-between gap-2">
                <span class="text-gray-5">Send to</span>
                <span class="fw-medium text-end">{{ pending.destination === 'gcash' ? 'GCash' : pending.bankName }}</span>
              </div>
              <div class="d-flex justify-content-between gap-2">
                <span class="text-gray-5">Account name</span>
                <span class="fw-medium text-end text-break">{{ pending.accountName }}</span>
              </div>
              <div class="d-flex justify-content-between align-items-center gap-2">
                <span class="text-gray-5">{{ pending.destination === 'gcash' ? 'GCash number' : 'Account number' }}</span>
                <span class="fw-medium text-end">
                  {{ pending.accountNumber }}
                  <button type="button" class="btn btn-sm btn-link p-0 ms-1" title="Copy" @click="copy(pending.accountNumber)">
                    <i class="ti" :class="copied === pending.accountNumber ? 'ti-check' : 'ti-copy'"></i>
                  </button>
                </span>
              </div>
              <div class="fs-12 text-gray-5 mt-2">
                Requested by {{ pending.requestedBy }} · {{ parseDbDate(pending.createdAt).toLocaleString() }}
              </div>
              <div v-if="pending.note" class="fs-12 text-gray-5 text-break">{{ pending.note }}</div>
            </div>

            <!-- On its way through PayMongo: nothing to do but wait for it -->
            <div v-if="pending.sending && pending.transfer" class="alert alert-info py-2" role="status">
              <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div class="min-w-0">
                  <div class="fw-medium">
                    <i class="ti ti-send me-1"></i>Sending through PayMongo ({{ transferProviderLabel(pending.transfer.provider) }})
                  </div>
                  <div class="fs-12 text-break">
                    Ref {{ pending.transfer.reference }}
                    <template v-if="pending.transfer.transferId"> · {{ pending.transfer.transferId }}</template>
                    · by {{ pending.transfer.sentBy }} · {{ parseDbDate(pending.transfer.createdAt).toLocaleString() }}
                  </div>
                  <div class="fs-12">InstaPay usually takes a few minutes; PESONet, up to a banking day.</div>
                </div>
                <button type="button" class="btn btn-sm btn-white border" :disabled="checking" @click="checkStatus">
                  <i class="ti ti-refresh me-1"></i>{{ checking ? 'Checking…' : 'Check status' }}
                </button>
              </div>
            </div>

            <template v-else>
              <div
                v-if="pending.transfer?.status === 'failed'"
                class="alert alert-warning py-2 fs-14"
                role="alert"
              >
                The last transfer ({{ pending.transfer.reference }}) failed: {{ pending.transfer.failureMessage }}
              </div>

              <div class="btn-group w-100 mb-3 flex-wrap" role="group" aria-label="What to do with this request">
                <button
                  v-if="summary.transfersEnabled"
                  type="button"
                  class="btn"
                  :class="mode === 'paymongo' ? 'btn-primary' : 'btn-white border'"
                  :aria-pressed="mode === 'paymongo'"
                  @click="mode = 'paymongo'"
                >
                  <i class="ti ti-send me-1"></i>Send via PayMongo
                </button>
                <button
                  type="button"
                  class="btn"
                  :class="mode === 'manual' ? 'btn-primary' : 'btn-white border'"
                  :aria-pressed="mode === 'manual'"
                  @click="mode = 'manual'"
                >
                  <i class="ti ti-check me-1"></i>Sent by hand
                </button>
                <button
                  type="button"
                  class="btn"
                  :class="mode === 'reject' ? 'btn-danger' : 'btn-white border'"
                  :aria-pressed="mode === 'reject'"
                  @click="mode = 'reject'"
                >
                  <i class="ti ti-x me-1"></i>Reject
                </button>
              </div>

              <div v-if="mode === 'paymongo'" class="mb-3">
                <div v-if="needsBank" class="mb-3">
                  <label class="form-label" for="payout-bank">Store's bank <span class="text-danger">*</span></label>
                  <select id="payout-bank" v-model="bankCode" class="form-select" :disabled="!banks">
                    <option value="" disabled>{{ banks ? `Choose the bank (the store wrote "${pending.bankName}")` : 'Loading banks…' }}</option>
                    <option v-for="b in banks ?? []" :key="b.code" :value="b.code">{{ b.name }}</option>
                  </select>
                </div>
                <p class="fs-14 text-gray-5 mb-0">
                  {{ peso(pending.receiveCents) }} goes from the platform's PayMongo Wallet to the account above by
                  {{ pending.receiveCents > INSTAPAY_MAX_CENTS ? 'PESONet (next banking cycle)' : 'InstaPay (usually instant)' }}.
                  <template v-if="pending.serviceChargeCents">
                    The {{ peso(pending.serviceChargeCents) }} service charge stays with the platform.
                  </template>
                  PayMongo charges the platform its transfer fee. The payout is recorded with its reference numbers once PayMongo
                  confirms it.
                </p>
              </div>
              <div v-else-if="mode === 'reject'" class="mb-3">
                <label class="form-label" for="payout-reject-reason">Reason (shown to the store) <span class="text-danger">*</span></label>
                <textarea id="payout-reject-reason" v-model="rejectReason" rows="2" maxlength="500" class="form-control"></textarea>
              </div>
              <div v-else class="row g-3 mb-3">
                <p v-if="pending.serviceChargeCents" class="col-12 fs-14 text-gray-5 mb-0">
                  Send the store {{ peso(pending.receiveCents) }}: the withdrawal less its
                  {{ peso(pending.serviceChargeCents) }} service charge.
                </p>
                <div class="col-sm-6">
                  <label class="form-label" for="payout-reference">Transfer reference no.</label>
                  <input id="payout-reference" v-model="reference" type="text" maxlength="50" class="form-control" />
                </div>
                <div class="col-sm-6">
                  <label class="form-label" for="payout-date">Date sent <span class="text-danger">*</span></label>
                  <input id="payout-date" v-model="paidDate" type="date" class="form-control" :max="toIsoDate()" />
                </div>
                <div class="col-12">
                  <label class="form-label" for="payout-note">Note</label>
                  <textarea id="payout-note" v-model="note" rows="2" maxlength="500" class="form-control"></textarea>
                </div>
              </div>
            </template>
          </template>

          <!-- A payout without a request -->
          <template v-else-if="summary.availableCents > 0">
            <h6 class="mb-2">Record a payout</h6>
            <p class="fs-12 text-gray-5">The store hasn't asked for a withdrawal. Record money you sent it anyway.</p>
            <div class="row g-3 mb-3">
              <div class="col-sm-6">
                <label class="form-label" for="payout-amount">Amount (₱) <span class="text-danger">*</span></label>
                <input id="payout-amount" v-model="amount" type="text" inputmode="decimal" class="form-control" />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="payout-method">Method <span class="text-danger">*</span></label>
                <select id="payout-method" v-model="method" class="form-select">
                  <option v-for="m in PAYMENT_METHODS" :key="m" :value="m">{{ paymentMethodLabel(m) }}</option>
                </select>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="payout-reference">Reference no.</label>
                <input id="payout-reference" v-model="reference" type="text" maxlength="50" class="form-control" />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="payout-date">Date <span class="text-danger">*</span></label>
                <input id="payout-date" v-model="paidDate" type="date" class="form-control" :max="toIsoDate()" />
              </div>
              <div class="col-12">
                <label class="form-label" for="payout-note">Note</label>
                <textarea id="payout-note" v-model="note" rows="2" maxlength="500" class="form-control"></textarea>
              </div>
            </div>
          </template>
          <p v-else class="text-gray-5 fs-14">Nothing is owed to this store right now.</p>

          <div class="row g-4">
            <div class="col-lg-6">
              <h6 class="mb-2">Withdrawal requests</h6>
              <div v-if="!summary.withdrawals.length" class="text-gray-5 fs-14">None yet.</div>
              <div v-for="w in summary.withdrawals" :key="w.id" class="list-row">
                <div class="min-w-0">
                  <div class="text-gray-9">
                    {{ w.reference }}
                    <span v-if="w.sending" class="badge ms-1" :class="TRANSFER_STATUS.pending.class">{{ TRANSFER_STATUS.pending.label }}</span>
                    <span v-else class="badge ms-1" :class="WITHDRAWAL_STATUS[w.status].class">{{ WITHDRAWAL_STATUS[w.status].label }}</span>
                  </div>
                  <div class="fs-12 text-gray-5 text-break">
                    {{ describeDestination(w) }} · {{ w.accountName }}
                    <template v-if="w.payout"> · {{ w.payout.reference }}</template>
                  </div>
                  <div v-if="w.rejectReason" class="fs-12 text-danger text-break">{{ w.rejectReason }}</div>
                </div>
                <div class="text-end text-nowrap">
                  <div class="fw-semibold">{{ peso(w.amountCents) }}</div>
                  <div v-if="w.serviceChargeCents" class="fs-12 text-gray-5">
                    {{ peso(w.serviceChargeCents) }} charge · send {{ peso(w.receiveCents) }}
                  </div>
                </div>
              </div>
            </div>
            <div class="col-lg-6">
              <h6 class="mb-2">Payouts</h6>
              <div v-if="!summary.payouts.length" class="text-gray-5 fs-14">No payouts yet.</div>
              <div v-for="p in summary.payouts" :key="p.id" class="list-row">
                <div class="min-w-0">
                  <div class="text-gray-9">{{ p.reference }} · {{ paymentMethodLabel(p.method) }}</div>
                  <div class="fs-12 text-gray-5 text-break">
                    {{ p.paidDate }}
                    <template v-if="p.paymentReference"> · Ref {{ p.paymentReference }}</template>
                    <template v-if="p.recordedBy"> · {{ p.recordedBy }}</template>
                    · recorded {{ parseDbDate(p.createdAt).toLocaleDateString() }}
                  </div>
                  <div v-if="p.note" class="fs-12 text-gray-5 text-break">{{ p.note }}</div>
                </div>
                <div class="text-end text-nowrap">
                  <div class="fw-semibold">{{ peso(p.amountCents) }}</div>
                  <div v-if="p.serviceChargeCents" class="fs-12 text-gray-5">
                    {{ peso(p.serviceChargeCents) }} charge · sent {{ peso(p.receivedCents) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Every transfer through PayMongo, whatever happened to it -->
          <template v-if="summary.transfers.length">
            <h6 class="mt-4 mb-2">PayMongo transfers</h6>
            <div v-for="t in summary.transfers" :key="t.id" class="list-row">
              <div class="min-w-0">
                <div class="text-gray-9">
                  {{ t.reference }}
                  <span class="badge ms-1" :class="TRANSFER_STATUS[t.status].class">{{ TRANSFER_STATUS[t.status].label }}</span>
                </div>
                <div class="fs-12 text-gray-5 text-break">
                  {{ transferProviderLabel(t.provider) }} to {{ t.bankName }} · {{ t.accountName }} · {{ t.accountNumber }}
                </div>
                <div class="fs-12 text-gray-5 text-break">
                  <template v-if="t.transferId">PayMongo {{ t.transferId }}</template>
                  <template v-if="t.providerReference"> · {{ transferProviderLabel(t.provider) }} ref {{ t.providerReference }}</template>
                  <template v-if="t.feeCents !== null"> · fee {{ peso(t.feeCents) }}</template>
                  · by {{ t.sentBy }} · {{ parseDbDate(t.createdAt).toLocaleString() }}
                </div>
                <div v-if="t.failureMessage" class="fs-12 text-danger text-break">{{ t.failureMessage }}</div>
              </div>
              <div class="fw-semibold text-nowrap">{{ peso(t.amountCents) }}</div>
            </div>
          </template>
        </template>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Close</button>
        <button
          v-if="pending && !pending.sending"
          type="submit"
          class="btn"
          :class="mode === 'reject' ? 'btn-danger' : 'btn-primary'"
          :disabled="saving"
        >
          <template v-if="saving">{{ mode === 'paymongo' ? 'Sending…' : 'Saving…' }}</template>
          <template v-else>
            {{ mode === 'paymongo' ? `Send ${peso(pending.receiveCents)}` : mode === 'reject' ? 'Reject Request' : 'Mark as Sent' }}
          </template>
        </button>
        <button v-else-if="summary && summary.availableCents > 0" type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : 'Record Payout' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.stat {
  padding: 10px;
  border-radius: 8px;
  background: #f9fafb;
}

@media (max-width: 575.98px) {
  .stat {
    padding: 8px 4px;
  }

  .stat .fw-bold {
    font-size: 13px;
    overflow-wrap: anywhere;
  }
}

.request {
  padding: 12px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
}

.list-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #e6eaed;
}

.min-w-0 {
  min-width: 0;
}
</style>
