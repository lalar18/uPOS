<script setup lang="ts">
// US Panel home: store counts, collections, and what needs attention today.
import { computed, ref } from 'vue'
import { formatDate, formatPrice } from '@/api/subscription'
import { getOverview, type Overview, type Renewal } from '@/api/usPanel'
import { currentSuperAdmin } from '@/usPanelAuth'
import { relativeDays } from './format'
import UsPaymentModal from './UsPaymentModal.vue'

const overview = ref<Overview | null>(null)
const loading = ref(false)
const loadError = ref('')
const notice = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    overview.value = await getOverview()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the overview'
  } finally {
    loading.value = false
  }
}
load()

/** Monthly recurring revenue: active stores × their plan's price */
const mrr = computed(() => overview.value?.plans.reduce((sum, p) => sum + p.active * p.monthlyPrice, 0) ?? 0)

const statCards = computed(() => {
  const s = overview.value?.stores
  if (!s) return []
  return [
    { label: 'Total stores', value: s.total, icon: 'building-store', color: 'primary', status: '' },
    { label: 'Active', value: s.active, icon: 'circle-check', color: 'success', status: 'active' },
    { label: 'Expiring this week', value: s.expiring, icon: 'clock-exclamation', color: 'warning', status: 'expiring' },
    { label: 'Expired', value: s.expired, icon: 'calendar-x', color: 'danger', status: 'expired' },
    { label: 'Disabled', value: s.disabled, icon: 'ban', color: 'secondary', status: 'disabled' },
  ]
})

const paying = ref<Renewal | null>(null)

function onPaid(renewal: Renewal) {
  paying.value = null
  notice.value = `Payment recorded. ${renewal.store.name} now runs until ${renewal.periodEnd ? formatDate(renewal.periodEnd) : 'the new date'}.`
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Welcome, {{ currentSuperAdmin?.fullName }}</h4>
      <h6>Stores, subscriptions and payments across USystems POS</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <RouterLink :to="{ name: 'us-stores', query: { add: '1' } }" class="btn btn-primary">
        <i class="ti ti-circle-plus me-1"></i>Add Store
      </RouterLink>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <template v-if="overview">
    <!-- Store counts -->
    <div class="row g-3 mb-4" :class="{ 'is-loading': loading }">
      <div v-for="card in statCards" :key="card.label" class="col-6 col-md-4 col-xl">
        <RouterLink
          :to="{ name: 'us-stores', query: card.status ? { status: card.status } : {} }"
          class="card stat-card h-100 mb-0"
        >
          <div class="card-body d-flex align-items-center gap-3">
            <span class="stat-icon" :class="`bg-${card.color}-transparent text-${card.color}`">
              <i class="ti" :class="`ti-${card.icon}`"></i>
            </span>
            <div>
              <div class="fs-13 text-gray-5">{{ card.label }}</div>
              <div class="fs-20 fw-bold text-gray-9">{{ card.value }}</div>
            </div>
          </div>
        </RouterLink>
      </div>
    </div>

    <!-- Money -->
    <div class="row g-3 mb-4">
      <div class="col-sm-6 col-xl-3">
        <div class="card h-100 mb-0">
          <div class="card-body">
            <div class="fs-13 text-gray-5">Collected this month</div>
            <div class="fs-20 fw-bold text-gray-9">{{ formatPrice(overview.revenue.thisMonth) }}</div>
          </div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="card h-100 mb-0">
          <div class="card-body">
            <div class="fs-13 text-gray-5">Collected last month</div>
            <div class="fs-20 fw-bold text-gray-9">{{ formatPrice(overview.revenue.lastMonth) }}</div>
          </div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="card h-100 mb-0">
          <div class="card-body">
            <div class="fs-13 text-gray-5">Monthly recurring (active stores)</div>
            <div class="fs-20 fw-bold text-gray-9">{{ formatPrice(mrr) }}</div>
          </div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="card h-100 mb-0">
          <div class="card-body">
            <div class="fs-13 text-gray-5">Collected all time</div>
            <div class="fs-20 fw-bold text-gray-9">{{ formatPrice(overview.revenue.allTime) }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <!-- Renewals waiting for payment -->
      <div class="col-xl-7">
        <div class="card h-100 mb-0">
          <div class="card-header d-flex align-items-center justify-content-between gap-2">
            <h5 class="card-title mb-0">
              Waiting for payment
              <span v-if="overview.pendingRenewals.total" class="badge bg-warning ms-1">
                {{ overview.pendingRenewals.total }}
              </span>
            </h5>
            <RouterLink :to="{ name: 'us-billing', query: { status: 'pending' } }" class="fs-14">View all</RouterLink>
          </div>
          <div class="card-body p-0">
            <div v-if="overview.pendingRenewals.items.length === 0" class="text-center text-gray-5 py-5">
              <i class="ti ti-circle-check fs-24 d-block mb-2"></i>No renewals waiting.
            </div>
            <div v-else class="table-responsive">
              <table class="table mb-0">
                <thead class="thead-light">
                  <tr>
                    <th>Store</th>
                    <th>Plan</th>
                    <th>Requested</th>
                    <th class="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="renewal in overview.pendingRenewals.items" :key="renewal.id">
                    <td>
                      <RouterLink :to="{ name: 'us-store', params: { id: renewal.store.id } }" class="fw-medium">
                        {{ renewal.store.name }}
                      </RouterLink>
                    </td>
                    <td>{{ renewal.plan.name }} · {{ formatPrice(renewal.plan.monthlyPrice) }}</td>
                    <td>{{ formatDate(renewal.createdAt) }}</td>
                    <td class="text-end">
                      <button type="button" class="btn btn-sm btn-primary" @click="paying = renewal">
                        Confirm payment
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Expiring or recently expired -->
      <div class="col-xl-5">
        <div class="card h-100 mb-0">
          <div class="card-header d-flex align-items-center justify-content-between gap-2">
            <h5 class="card-title mb-0">Expiring &amp; recently expired</h5>
            <RouterLink :to="{ name: 'us-stores', query: { sort: 'expiry' } }" class="fs-14">View all</RouterLink>
          </div>
          <div class="card-body p-0">
            <div v-if="overview.expiringStores.length === 0" class="text-center text-gray-5 py-5">
              <i class="ti ti-calendar-check fs-24 d-block mb-2"></i>No stores need attention.
            </div>
            <ul v-else class="list-unstyled mb-0">
              <li
                v-for="store in overview.expiringStores"
                :key="store.id"
                class="d-flex align-items-center justify-content-between gap-2 px-3 py-2 border-bottom"
              >
                <div class="min-w-0">
                  <RouterLink :to="{ name: 'us-store', params: { id: store.id } }" class="fw-medium text-break">
                    {{ store.name }}
                  </RouterLink>
                  <div class="fs-12 text-gray-5">
                    {{ store.planName }} · {{ store.expired ? 'expired' : 'expires' }} {{ relativeDays(store.expiresAt) }}
                  </div>
                </div>
                <span v-if="store.pendingRenewal" class="badge bg-warning">Renewal waiting</span>
                <span v-else class="badge" :class="store.expired ? 'bg-danger' : 'bg-warning'">
                  {{ formatDate(store.expiresAt) }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Plans -->
      <div class="col-12">
        <div class="card mb-0">
          <div class="card-header d-flex align-items-center justify-content-between gap-2">
            <h5 class="card-title mb-0">Stores by plan</h5>
            <RouterLink :to="{ name: 'us-plans' }" class="fs-14">Manage plans</RouterLink>
          </div>
          <div class="table-responsive">
            <table class="table mb-0">
              <thead class="thead-light">
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Stores</th>
                  <th>Active</th>
                  <th>Monthly from active</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plan in overview.plans" :key="plan.id">
                  <td>
                    <RouterLink :to="{ name: 'us-stores', query: { planId: plan.id } }" class="fw-medium">
                      {{ plan.name }}
                    </RouterLink>
                  </td>
                  <td>{{ formatPrice(plan.monthlyPrice) }}/mo</td>
                  <td>{{ plan.stores }}</td>
                  <td>{{ plan.active }}</td>
                  <td>{{ formatPrice(plan.active * plan.monthlyPrice) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </template>

  <UsPaymentModal v-if="paying" :renewal="paying" @close="paying = null" @saved="onPaid" />
</template>

<style scoped>
.stat-card {
  color: inherit;
  transition: box-shadow 0.15s;
}

.stat-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  font-size: 22px;
}
</style>
