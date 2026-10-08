<script setup lang="ts">
// Every renewal and payment across stores. Renewals waiting for payment come first; confirm
// one once the store has paid, and the store is extended by the months paid for.
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { paymentMethodLabel } from '@/api/sales'
import { storeCode } from '@/api/store'
import { formatDate, formatPrice } from '@/api/subscription'
import { cancelRenewal, listRenewals, type Renewal, type RenewalStatus } from '@/api/usPanel'
import ListPager from '@/components/ListPager.vue'
import { renewalBadge } from './format'
import UsConfirmModal from './UsConfirmModal.vue'
import UsPaymentModal from './UsPaymentModal.vue'

const route = useRoute()
const STATUSES: RenewalStatus[] = ['pending', 'paid', 'cancelled']

const items = ref<Renewal[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const notice = ref('')

const search = ref('')
const statusFilter = ref<RenewalStatus | ''>(STATUSES.find((s) => s === route.query.status) ?? '')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listRenewals({
      status: statusFilter.value,
      search: search.value.trim(),
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load billing'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function resetToFirstPage() {
  if (page.value === 1) load()
  else page.value = 1
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(resetToFirstPage, 300)
})
watch([statusFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

const paying = ref<Renewal | null>(null)
const cancelling = ref<Renewal | null>(null)

function onPaid(renewal: Renewal) {
  paying.value = null
  notice.value = `Payment recorded. ${renewal.store.name} now runs until ${renewal.periodEnd ? formatDate(renewal.periodEnd) : 'the new date'}.`
  load()
}

function onCancelled() {
  notice.value = `Renewal request from ${cancelling.value?.store.name ?? 'the store'} cancelled.`
  cancelling.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Billing</h4>
      <h6>Subscription renewals and payments from every store</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <div class="card">
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="search-set">
        <div class="search-input position-relative">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Store name, STR code or reference"
            aria-label="Search billing"
          />
        </div>
      </div>
      <div class="filters d-flex gap-2">
        <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
          <option value="">All</option>
          <option value="pending">Waiting for payment</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <div class="table-responsive">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Store</th>
              <th>Plan</th>
              <th>Requested</th>
              <th>Paid</th>
              <th>Period</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Status</th>
              <th class="text-end"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="renewal in items" :key="renewal.id">
              <td>
                <RouterLink :to="{ name: 'us-store', params: { id: renewal.store.id } }" class="fw-medium text-gray-9">
                  {{ renewal.store.name }}
                </RouterLink>
                <div class="fs-12 text-gray-5">{{ storeCode(renewal.store.id) }}</div>
              </td>
              <td>
                {{ renewal.plan.name }}
                <span class="text-gray-5">· {{ renewal.months }} mo</span>
              </td>
              <td>
                {{ formatDate(renewal.createdAt) }}
                <div class="fs-12 text-gray-5">{{ renewal.requestedBy ?? 'Recorded in US Panel' }}</div>
              </td>
              <td>{{ renewal.paidAt ? formatDate(renewal.paidAt) : '—' }}</td>
              <td>
                <template v-if="renewal.periodStart && renewal.periodEnd">
                  {{ formatDate(renewal.periodStart) }} – {{ formatDate(renewal.periodEnd) }}
                </template>
                <template v-else>—</template>
              </td>
              <td>
                <template v-if="renewal.amount !== null">{{ formatPrice(renewal.amount) }}</template>
                <span v-else class="text-gray-5">{{ formatPrice(renewal.plan.monthlyPrice) }}/mo due</span>
              </td>
              <td>
                <template v-if="renewal.paymentMethod">
                  {{ paymentMethodLabel(renewal.paymentMethod) }}
                  <div v-if="renewal.reference" class="fs-12 text-gray-5">Ref {{ renewal.reference }}</div>
                </template>
                <template v-else>—</template>
                <div v-if="renewal.confirmedBy" class="fs-12 text-gray-5">by {{ renewal.confirmedBy }}</div>
              </td>
              <td>
                <span class="badge" :class="renewalBadge(renewal.status).class">{{ renewalBadge(renewal.status).label }}</span>
              </td>
              <td class="text-end">
                <div v-if="renewal.status === 'pending'" class="d-inline-flex gap-2">
                  <button type="button" class="btn btn-sm btn-white border" @click="cancelling = renewal">Cancel</button>
                  <button type="button" class="btn btn-sm btn-primary" @click="paying = renewal">Confirm payment</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-receipt-2 fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter">Nothing matches your filters.</template>
        <template v-else>No renewals or payments yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Billing pages" />
  </div>

  <UsPaymentModal v-if="paying" :renewal="paying" @close="paying = null" @saved="onPaid" />
  <UsConfirmModal
    v-if="cancelling"
    title="Cancel Renewal Request"
    :message="`Cancel the ${cancelling.plan.name} renewal request from ${cancelling.store.name}? Their admin can request again.`"
    confirm-label="Cancel Request"
    danger
    :action="() => cancelRenewal(cancelling!.id)"
    @close="cancelling = null"
    @done="onCancelled"
  />
</template>
