<script setup lang="ts">
// A store's wallet: what it's owed, the withdrawal it asked for (send it, or reject it), recording
// a payout made without a request, and the history.
import { computed, ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { PAYMENT_METHODS, paymentMethodLabel } from '@/api/sales'
import { describeDestination, WITHDRAWAL_STATUS, type Wallet } from '@/api/store'
import { getStorePayouts, recordPayout, rejectWithdrawal, sendWithdrawal } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { toIsoDate } from '@/utils/date'
import { centsToText, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{ store: { id: number; name: string } }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const summary = ref<Wallet | null>(null)
const amount = ref('')
const method = ref('bank_transfer')
const reference = ref('')
const paidDate = ref(toIsoDate())
const note = ref('')
const rejecting = ref(false)
const rejectReason = ref('')
const error = ref('')
const saving = ref(false)

const peso = (cents: number) => formatMoney(cents, 'PHP')
const pending = computed(() => summary.value?.pendingWithdrawal ?? null)

getStorePayouts(props.store.id)
  .then((result) => {
    summary.value = result
    amount.value = result.availableCents > 0 ? centsToText(result.availableCents) : ''
  })
  .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the payouts'))

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
    if (rejecting.value) {
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
      `${peso(request.amountCents)} marked as sent to ${props.store.name}.`,
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
              <div class="d-flex justify-content-between gap-2 mb-2">
                <span class="text-gray-5">Amount</span>
                <span class="fs-18 fw-bold text-gray-9">{{ peso(pending.amountCents) }}</span>
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

            <div class="form-check form-switch mb-3">
              <input id="payout-reject" v-model="rejecting" class="form-check-input" type="checkbox" />
              <label class="form-check-label" for="payout-reject">Reject this request instead</label>
            </div>
            <div v-if="rejecting" class="mb-3">
              <label class="form-label" for="payout-reject-reason">Reason (shown to the store) <span class="text-danger">*</span></label>
              <textarea id="payout-reject-reason" v-model="rejectReason" rows="2" maxlength="500" class="form-control"></textarea>
            </div>
            <div v-else class="row g-3 mb-3">
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
                    <span class="badge ms-1" :class="WITHDRAWAL_STATUS[w.status].class">{{ WITHDRAWAL_STATUS[w.status].label }}</span>
                  </div>
                  <div class="fs-12 text-gray-5 text-break">
                    {{ describeDestination(w) }} · {{ w.accountName }}
                    <template v-if="w.payout"> · {{ w.payout.reference }}</template>
                  </div>
                  <div v-if="w.rejectReason" class="fs-12 text-danger text-break">{{ w.rejectReason }}</div>
                </div>
                <div class="fw-semibold text-nowrap">{{ peso(w.amountCents) }}</div>
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
                <div class="fw-semibold text-nowrap">{{ peso(p.amountCents) }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Close</button>
        <button v-if="pending" type="submit" class="btn" :class="rejecting ? 'btn-danger' : 'btn-primary'" :disabled="saving">
          {{ saving ? 'Saving…' : rejecting ? 'Reject Request' : 'Mark as Sent' }}
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
