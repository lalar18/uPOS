<script setup lang="ts">
// A store's online sales payouts: what it's owed, recording a payout, and the payouts so far.
import { ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { PAYMENT_METHODS, paymentMethodLabel } from '@/api/sales'
import type { PayoutSummary } from '@/api/store'
import { getStorePayouts, recordPayout } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { toIsoDate } from '@/utils/date'
import { centsToText, formatMoney, parsePeso } from '@/utils/money'

const props = defineProps<{ store: { id: number; name: string } }>()
const emit = defineEmits<{ close: []; saved: [summary: PayoutSummary] }>()

const summary = ref<PayoutSummary | null>(null)
const amount = ref('')
const method = ref('bank_transfer')
const reference = ref('')
const paidDate = ref(toIsoDate())
const note = ref('')
const error = ref('')
const saving = ref(false)

const peso = (cents: number) => formatMoney(cents, 'PHP')

getStorePayouts(props.store.id)
  .then((result) => {
    summary.value = result
    amount.value = result.balanceCents > 0 ? centsToText(result.balanceCents) : ''
  })
  .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the payouts'))

async function save() {
  error.value = ''
  const cents = parsePeso(amount.value)
  if (cents === null || Number.isNaN(cents) || cents <= 0) {
    error.value = 'Enter the amount paid out, like 1500.00.'
    return
  }
  if (summary.value && cents > summary.value.balanceCents) {
    error.value = `The store is only owed ${peso(summary.value.balanceCents)}.`
    return
  }
  if (!paidDate.value || paidDate.value > toIsoDate()) {
    error.value = 'Choose the payout date (not in the future).'
    return
  }
  saving.value = true
  try {
    const saved = await recordPayout(props.store.id, {
      amountCents: cents,
      method: method.value,
      reference: reference.value,
      note: note.value,
      paidDate: paidDate.value,
    })
    emit('saved', saved)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not record the payout'
  } finally {
    saving.value = false
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

          <template v-if="summary.balanceCents > 0">
            <h6 class="mb-2">Record a payout</h6>
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
        </template>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Close</button>
        <button v-if="summary && summary.balanceCents > 0" type="submit" class="btn btn-primary" :disabled="saving">
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
