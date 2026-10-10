<script setup lang="ts">
// Payouts of online sales: sales paid online go into the platform's PayMongo account and sit in
// each store's wallet until the store asks to withdraw them; requests are sent and recorded here.
import { computed, ref } from 'vue'
import { storeCode } from '@/api/store'
import { listPayoutBalances, type StoreBalance } from '@/api/usPanel'
import { formatMoney } from '@/utils/money'
import UsPayoutModal from './UsPayoutModal.vue'

const data = ref<Awaited<ReturnType<typeof listPayoutBalances>> | null>(null)
const loading = ref(false)
const loadError = ref('')
const notice = ref('')
const selected = ref<StoreBalance | null>(null)

const peso = (cents: number) => formatMoney(cents, 'PHP')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await listPayoutBalances()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the payouts'
  } finally {
    loading.value = false
  }
}
load()

const summaryCards = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { label: 'Sales paid online', value: peso(t.collectedCents), icon: 'credit-card', color: 'primary' },
    { label: 'Paid out', value: peso(t.paidOutCents), icon: 'send', color: 'success' },
    { label: 'Owed to stores', value: peso(t.balanceCents), icon: 'building-store', color: 'danger' },
    { label: 'Withdrawals to send', value: String(t.pendingWithdrawals), icon: 'cash-banknote', color: 'warning' },
    { label: 'Refunds to make', value: String(t.refundsDue), icon: 'receipt-refund', color: 'secondary' },
  ]
})

function onSaved(message: string) {
  notice.value = message
  selected.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Payouts</h4>
      <h6>Sales paid online through PayMongo, held in each store's wallet</h6>
    </div>
    <div class="page-actions">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <template v-if="data">
    <div class="row g-3 mb-4" :class="{ 'is-loading': loading }">
      <div v-for="card in summaryCards" :key="card.label" class="col-sm-6 col-xl">
        <div class="card h-100 mb-0">
          <div class="card-body d-flex align-items-center gap-3">
            <span class="avatar avatar-lg rounded-circle flex-shrink-0" :class="`bg-${card.color}-transparent text-${card.color}`">
              <i class="ti fs-24" :class="`ti-${card.icon}`"></i>
            </span>
            <div class="min-w-0">
              <div class="fs-13 text-gray-5">{{ card.label }}</div>
              <div class="fs-20 fw-bold text-gray-9">{{ card.value }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table mb-0" :class="{ 'is-loading': loading }">
            <thead class="thead-light">
              <tr>
                <th>Store</th>
                <th class="text-end">Paid online</th>
                <th class="text-end">Paid out</th>
                <th class="text-end">Owed</th>
                <th>Last payout</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in data.stores" :key="s.id">
                <td>
                  <RouterLink :to="{ name: 'us-store', params: { id: s.id } }" class="fw-medium text-gray-9">{{ s.name }}</RouterLink>
                  <div class="fs-12 text-gray-5">{{ storeCode(s.id) }}</div>
                  <span v-if="s.pendingWithdrawal" class="badge bg-warning me-1">
                    Withdraw {{ peso(s.pendingWithdrawal.amountCents) }}
                  </span>
                  <span v-if="s.refundsDue" class="badge bg-secondary">{{ s.refundsDue }} to refund</span>
                </td>
                <td class="text-end">{{ peso(s.collectedCents) }}</td>
                <td class="text-end">{{ peso(s.paidOutCents) }}</td>
                <td class="text-end fw-bold" :class="s.balanceCents > 0 ? 'text-danger' : 'text-gray-9'">
                  {{ peso(s.balanceCents) }}
                </td>
                <td>{{ s.lastPayoutDate ?? '—' }}</td>
                <td class="text-end">
                  <button
                    type="button"
                    class="btn btn-sm text-nowrap"
                    :class="s.pendingWithdrawal ? 'btn-primary' : 'btn-white border'"
                    @click="selected = s"
                  >
                    {{ s.pendingWithdrawal ? 'Send' : s.balanceCents > 0 ? 'Pay Out' : 'History' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!loading && data.stores.length === 0" class="text-center text-gray-5 py-5">
          <i class="ti ti-credit-card fs-24 d-block mb-2"></i>No sales have been paid online yet.
        </div>
      </div>
    </div>
  </template>

  <UsPayoutModal v-if="selected" :store="selected" @close="selected = null" @saved="onSaved" />
</template>
