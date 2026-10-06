<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { deleteCustomer, listCustomers, type Customer, type CustomerStatus } from '@/api/customers'
import { parseDbDate } from '@/api/http'
import { formatPeso } from '@/api/products'
import { currentUser } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import CustomerFormModal from '@/components/CustomerFormModal.vue'
import ListPager from '@/components/ListPager.vue'

// Anyone can add a customer (cashiers do at the till); only admins edit or delete
const isAdmin = computed(() => currentUser.value?.role === 'admin')

// --- List, filters and paging ---

const items = ref<Customer[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<CustomerStatus | ''>('')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listCustomers({
      search: search.value.trim(),
      status: statusFilter.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return // a newer search already went out

    // Deleting the last row on a page leaves it empty; step back a page
    if (result.items.length === 0 && page.value > 1 && result.total > 0) {
      page.value = Math.ceil(result.total / pageSize.value)
      return
    }
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load customers'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function resetToFirstPage() {
  if (page.value === 1) load()
  else page.value = 1 // the page watcher reloads
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(resetToFirstPage, 300)
})
watch([statusFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

const dateFormat = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))

// --- Dialogs ---

const formOpen = ref(false)
const editing = ref<Customer | null>(null) // null while adding
const deleting = ref<Customer | null>(null)

function openForm(customer: Customer | null) {
  editing.value = customer
  formOpen.value = true
}

function onSaved() {
  formOpen.value = false
  load() // the list is sorted by name, so the saved row may move pages
}

function onDeleted() {
  deleting.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Customers</h4>
      <h6>Manage your customers</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Customer
      </button>
    </div>
  </div>

  <div class="card">
    <!-- Search and filter -->
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="search-set">
        <div class="search-input">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Search name, phone or email"
            aria-label="Search customers"
          />
        </div>
      </div>
      <select v-model="statusFilter" class="form-select status-filter" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (tablets and up) -->
      <div class="table-responsive d-none d-md-block">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Address</th>
              <th class="text-end">Sales</th>
              <th class="text-end">Balance Due</th>
              <th>Created On</th>
              <th>Status</th>
              <th v-if="isAdmin" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="customer in items" :key="customer.id">
              <td>
                <div class="fw-medium text-gray-9">{{ customer.name }}</div>
                <div v-if="customer.email" class="fs-12 text-gray-5">{{ customer.email }}</div>
              </td>
              <td>{{ customer.phone ?? '—' }}</td>
              <td class="address-cell" :title="customer.address ?? undefined">{{ customer.address ?? '—' }}</td>
              <td class="text-end">{{ customer.saleCount }}</td>
              <td class="text-end" :class="{ 'text-danger fw-medium': customer.balanceCents > 0 }">
                {{ formatPeso(customer.balanceCents) }}
              </td>
              <td>{{ formatDate(customer.createdAt) }}</td>
              <td>
                <span class="badge" :class="customer.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ customer.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="isAdmin" class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(customer)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = customer"><i class="ti ti-trash"></i></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones) -->
      <div class="d-md-none" :class="{ 'is-loading': loading }">
        <div v-for="customer in items" :key="customer.id" class="list-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ customer.name }}</div>
              <div v-if="customer.phone" class="fs-12 text-gray-5 text-break">
                <i class="ti ti-phone me-1"></i>{{ customer.phone }}
              </div>
              <div v-if="customer.email" class="fs-12 text-gray-5 text-break">
                <i class="ti ti-mail me-1"></i>{{ customer.email }}
              </div>
            </div>
            <span class="badge flex-shrink-0" :class="customer.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ customer.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="d-flex justify-content-between align-items-center gap-2 mt-2">
            <span class="fs-12 text-gray-5">
              {{ customer.saleCount }} {{ customer.saleCount === 1 ? 'sale' : 'sales' }}
              <template v-if="customer.balanceCents > 0">
                · <span class="text-danger fw-medium">{{ formatPeso(customer.balanceCents) }} due</span>
              </template>
            </span>
            <div v-if="isAdmin" class="row-actions">
              <button type="button" title="Edit" @click="openForm(customer)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = customer"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-users-group fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter">No customers match your filters.</template>
        <template v-else>No customers yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Customer pages" />
  </div>

  <CustomerFormModal v-if="formOpen" :customer="editing" @close="formOpen = false" @saved="onSaved" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Customer"
    :item-name="deleting.name"
    :action="() => deleteCustomer(deleting!.id)"
    @close="deleting = null"
    @deleted="onDeleted"
  />
</template>

<style scoped>
.search-input .search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #a6aaaf;
  pointer-events: none;
}

.search-input input {
  padding-left: 32px;
  min-width: 260px;
}

.status-filter {
  width: auto;
  min-width: 150px;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.address-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  font-size: 11px;
}

.row-actions {
  display: inline-flex;
  gap: 8px;
}

.row-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #212b36;
}

.row-actions button:hover {
  background: #e6eaed;
}

.list-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.list-card:last-child {
  border-bottom: 0;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

@media (max-width: 575.98px) {
  .search-set,
  .search-input,
  .search-input input,
  .status-filter {
    width: 100%;
    min-width: 0;
  }

  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
