<script setup lang="ts">
// Every store, with its plan, expiry and status. Filters can be opened from the dashboard
// (?status=, ?planId=, ?sort=expiry), and ?add=1 opens the Add Store form.
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeCode } from '@/api/store'
import { formatDate, getPlans, type Plan } from '@/api/subscription'
import { listStores, type StoreDetail, type StoreQuery, type StoreStatusFilter, type StoreSummary } from '@/api/usPanel'
import ListPager from '@/components/ListPager.vue'
import { relativeDays, storeStatus } from './format'
import UsStoreCreateModal from './UsStoreCreateModal.vue'

const route = useRoute()
const router = useRouter()

const STATUSES: StoreStatusFilter[] = ['active', 'expiring', 'expired', 'disabled', 'pending']
const queryText = (value: unknown) => (typeof value === 'string' ? value : '')

const items = ref<StoreSummary[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<StoreStatusFilter>(
  STATUSES.find((s) => s === route.query.status) ?? '',
)
const planFilter = ref(queryText(route.query.planId))
const sort = ref<StoreQuery['sort']>(route.query.sort === 'expiry' ? 'expiry' : 'newest')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listStores({
      search: search.value.trim(),
      status: statusFilter.value,
      planId: planFilter.value,
      sort: sort.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load stores'
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
watch([statusFilter, planFilter, sort, pageSize], resetToFirstPage)
watch(page, load)
load()

const plans = ref<Plan[]>([])
getPlans()
  .then((value) => (plans.value = value))
  .catch(() => (plans.value = []))

// --- Add store ---

const adding = ref(route.query.add === '1')
if (adding.value) router.replace({ query: { ...route.query, add: undefined } })

function onCreated(store: StoreDetail) {
  adding.value = false
  router.push({ name: 'us-store', params: { id: store.id } })
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Stores</h4>
      <h6>Every store on USystems POS</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button type="button" class="btn btn-primary" @click="adding = true">
        <i class="ti ti-circle-plus me-1"></i>Add Store
      </button>
    </div>
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
            placeholder="Name, email, phone, STR code or user email"
            aria-label="Search stores"
          />
        </div>
      </div>
      <div class="filters d-flex flex-wrap gap-2">
        <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring this week</option>
          <option value="expired">Expired</option>
          <option value="disabled">Disabled</option>
          <option value="pending">Renewal waiting</option>
        </select>
        <select v-model="planFilter" class="form-select" aria-label="Filter by plan">
          <option value="">All plans</option>
          <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option>
        </select>
        <select v-model="sort" class="form-select" aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="expiry">Expiring first</option>
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
              <th>Expires</th>
              <th>Users</th>
              <th>Products</th>
              <th>Status</th>
              <th class="text-end"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="store in items" :key="store.id">
              <td>
                <RouterLink :to="{ name: 'us-store', params: { id: store.id } }" class="fw-medium text-gray-9">
                  {{ store.name }}
                </RouterLink>
                <div class="fs-12 text-gray-5">
                  {{ storeCode(store.id) }}<template v-if="store.email || store.phone"> · {{ store.email ?? store.phone }}</template>
                </div>
              </td>
              <td>{{ store.plan.name }}</td>
              <td>
                <template v-if="store.expiresAt">
                  {{ formatDate(store.expiresAt) }}
                  <div class="fs-12" :class="store.expired ? 'text-danger' : 'text-gray-5'">
                    {{ relativeDays(store.expiresAt) }}
                  </div>
                </template>
                <template v-else>—</template>
              </td>
              <td>{{ store.users }}</td>
              <td>{{ store.products.toLocaleString('en-US') }}</td>
              <td>
                <span class="badge" :class="storeStatus(store).class">{{ storeStatus(store).label }}</span>
                <span v-if="store.pendingRenewal" class="badge bg-warning-transparent text-warning ms-1">
                  Renewal waiting
                </span>
              </td>
              <td class="text-end">
                <div class="row-actions">
                  <RouterLink :to="{ name: 'us-store', params: { id: store.id } }" title="Open">
                    <i class="ti ti-chevron-right"></i>
                  </RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-building-store fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter || planFilter">No stores match your filters.</template>
        <template v-else>No stores yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Store pages" />
  </div>

  <UsStoreCreateModal v-if="adding" :plans="plans" @close="adding = false" @saved="onCreated" />
</template>
