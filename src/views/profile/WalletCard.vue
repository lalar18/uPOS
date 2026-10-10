<script setup lang="ts">
// The store's wallet, on the Profile page (Admin role only). Sales paid online (card, GCash, Maya
// through PayMongo) are held by the platform, without the service charge, until the store
// withdraws them to a GCash number or bank account.
import { computed, ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { paymentMethodLabel } from '@/api/sales'
import {
  cancelWithdrawal,
  describeDestination,
  getWallet,
  WITHDRAWAL_STATUS,
  type Wallet,
} from '@/api/store'
import { currentUser } from '@/auth'
import { formatMoney } from '@/utils/money'
import WithdrawModal from './WithdrawModal.vue'

const wallet = ref<Wallet | null>(null)
const loadError = ref('')
const actionError = ref('')
const notice = ref('')
const withdrawing = ref(false)
const cancelling = ref(false)

getWallet()
  .then((value) => (wallet.value = value))
  .catch((e) => (loadError.value = e instanceof Error ? e.message : 'Could not load your wallet'))

// Online payment is for stores selling in pesos; others only see a wallet they already used
const shown = computed(
  () =>
    currentUser.value?.store.currency === 'PHP' ||
    !!wallet.value?.onlinePayments ||
    !!wallet.value?.payouts.length ||
    !!loadError.value,
)

const peso = (cents: number) => formatMoney(cents, 'PHP')
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))

function onRequested(value: Wallet) {
  wallet.value = value
  withdrawing.value = false
  notice.value = `Withdrawal of ${peso(value.pendingWithdrawalCents)} requested. You'll see it here once it's sent.`
}

async function cancelPending() {
  const pending = wallet.value?.pendingWithdrawal
  if (!pending || !confirm(`Cancel the withdrawal of ${peso(pending.amountCents)}?`)) return
  actionError.value = ''
  notice.value = ''
  cancelling.value = true
  try {
    wallet.value = await cancelWithdrawal(pending.id)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Could not cancel the withdrawal'
    getWallet().then((value) => (wallet.value = value)).catch(() => {})
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div v-if="shown" class="card">
    <div class="card-header d-flex align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0"><i class="ti ti-wallet me-2"></i>Wallet</h5>
      <button
        v-if="wallet"
        type="button"
        class="btn btn-sm btn-primary"
        :disabled="wallet.availableCents <= 0 || !!wallet.pendingWithdrawal"
        :title="wallet.pendingWithdrawal ? 'Wait for your pending withdrawal, or cancel it' : ''"
        @click="withdrawing = true"
      >
        <i class="ti ti-cash-banknote me-1"></i>Withdraw
      </button>
    </div>
    <div class="card-body">
      <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
      <div v-if="actionError" class="alert alert-danger py-2" role="alert">{{ actionError }}</div>
      <div v-if="notice" class="alert alert-success py-2" role="status">{{ notice }}</div>

      <template v-if="wallet">
        <p class="fs-14 text-gray-5">
          Sales your customers pay online (card, GCash, Maya) go to your wallet. Service charges aren't included. Withdraw
          to your GCash or bank account any time.
        </p>

        <div class="row g-2 mb-3 text-center">
          <div class="col-6 col-lg-3">
            <div class="stat">
              <div class="fs-12 text-gray-5">Available</div>
              <div class="fs-18 fw-bold text-primary">{{ peso(wallet.availableCents) }}</div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat">
              <div class="fs-12 text-gray-5">Pending withdrawal</div>
              <div class="fs-18 fw-bold text-gray-9">{{ peso(wallet.pendingWithdrawalCents) }}</div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat">
              <div class="fs-12 text-gray-5">Paid online</div>
              <div class="fs-18 fw-bold text-gray-9">{{ peso(wallet.collectedCents) }}</div>
              <div class="fs-12 text-gray-5">
                {{ wallet.onlinePayments }} payment{{ wallet.onlinePayments === 1 ? '' : 's' }}
              </div>
            </div>
          </div>
          <div class="col-6 col-lg-3">
            <div class="stat">
              <div class="fs-12 text-gray-5">Withdrawn</div>
              <div class="fs-18 fw-bold text-gray-9">{{ peso(wallet.paidOutCents) }}</div>
            </div>
          </div>
        </div>

        <div
          v-if="wallet.pendingWithdrawal"
          class="alert alert-info py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"
          role="status"
        >
          <div class="min-w-0">
            <i class="ti ti-hourglass me-1"></i>{{ peso(wallet.pendingWithdrawal.amountCents) }} to
            {{ describeDestination(wallet.pendingWithdrawal) }} ({{ wallet.pendingWithdrawal.accountName }}), requested
            {{ formatDate(wallet.pendingWithdrawal.createdAt) }}, is waiting to be sent.
          </div>
          <button type="button" class="btn btn-sm btn-white border" :disabled="cancelling" @click="cancelPending">
            {{ cancelling ? 'Cancelling…' : 'Cancel' }}
          </button>
        </div>

        <div v-if="wallet.refundsDue.length" class="alert alert-warning py-2 fs-14" role="alert">
          {{ wallet.refundsDue.length }} online payment{{ wallet.refundsDue.length === 1 ? ' was' : 's were' }} made after
          the sale was already paid ({{ wallet.refundsDue.map((r) => r.sale.reference).join(', ') }}). The platform will
          refund the customer.
        </div>

        <div class="row g-4">
          <div class="col-lg-6">
            <h6 class="mb-2">Withdrawals</h6>
            <div v-if="!wallet.withdrawals.length" class="text-gray-5 fs-14">No withdrawals yet.</div>
            <div v-for="w in wallet.withdrawals" :key="w.id" class="list-row">
              <div class="min-w-0">
                <div class="text-gray-9">
                  {{ w.reference }} <span class="badge ms-1" :class="WITHDRAWAL_STATUS[w.status].class">{{ WITHDRAWAL_STATUS[w.status].label }}</span>
                </div>
                <div class="fs-12 text-gray-5 text-break">
                  {{ describeDestination(w) }} · {{ w.accountName }} · {{ formatDate(w.createdAt) }}
                </div>
                <div v-if="w.rejectReason" class="fs-12 text-danger text-break">{{ w.rejectReason }}</div>
              </div>
              <div class="fw-semibold text-nowrap">{{ peso(w.amountCents) }}</div>
            </div>
          </div>
          <div class="col-lg-6">
            <h6 class="mb-2">Money sent to you</h6>
            <div v-if="!wallet.payouts.length" class="text-gray-5 fs-14">Nothing sent yet.</div>
            <div v-for="p in wallet.payouts" :key="p.id" class="list-row">
              <div class="min-w-0">
                <div class="text-gray-9">{{ p.reference }} · {{ paymentMethodLabel(p.method) }}</div>
                <div class="fs-12 text-gray-5 text-break">
                  {{ p.paidDate }}<template v-if="p.paymentReference"> · Ref {{ p.paymentReference }}</template>
                </div>
              </div>
              <div class="fw-semibold text-nowrap">{{ peso(p.amountCents) }}</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <WithdrawModal v-if="withdrawing && wallet" :wallet="wallet" @close="withdrawing = false" @saved="onRequested" />
</template>

<style scoped>
.stat {
  height: 100%;
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
