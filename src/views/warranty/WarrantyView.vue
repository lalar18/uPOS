<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseDbDate } from '@/api/http'
import {
  deleteWarranty,
  formatDuration,
  listWarranties,
  type Warranty,
  type WarrantyStatus,
} from '@/api/warranties'
import { can } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import ListPager from '@/components/ListPager.vue'
import WarrantyFormModal from './WarrantyFormModal.vue'

const canEdit = computed(() => can('catalog.manage'))

// --- List, filters and paging ---

const items = ref<Warranty[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<WarrantyStatus | ''>('')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listWarranties({
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
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load warranties'
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
const editing = ref<Warranty | null>(null) // null while adding
const deleting = ref<Warranty | null>(null)

function openForm(warranty: Warranty | null) {
  editing.value = warranty
  formOpen.value = true
}

function onSaved(_warranty: Warranty, isNew: boolean) {
  formOpen.value = false
  if (isNew) resetToFirstPage() // new rows appear at the top of page 1
  else load()
}

function onDeleted() {
  deleting.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Warranties</h4>
      <h6>Manage the warranties on your products</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="canEdit" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Warranty
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
            placeholder="Search"
            aria-label="Search warranties"
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
              <th>Warranty</th>
              <th>Description</th>
              <th>Duration</th>
              <th>Products</th>
              <th>Created On</th>
              <th>Status</th>
              <th v-if="canEdit" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="warranty in items" :key="warranty.id">
              <td class="fw-medium text-gray-9">{{ warranty.name }}</td>
              <td class="description-cell" :title="warranty.description ?? ''">{{ warranty.description ?? '—' }}</td>
              <td>{{ formatDuration(warranty.duration, warranty.durationUnit) }}</td>
              <td>{{ warranty.productCount }}</td>
              <td>{{ formatDate(warranty.createdAt) }}</td>
              <td>
                <span class="badge" :class="warranty.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ warranty.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="canEdit" class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(warranty)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = warranty"><i class="ti ti-trash"></i></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones) -->
      <div class="d-md-none" :class="{ 'is-loading': loading }">
        <div v-for="warranty in items" :key="warranty.id" class="list-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ warranty.name }}</div>
              <div class="fs-12 text-gray-5">
                {{ formatDuration(warranty.duration, warranty.durationUnit) }}
                · {{ warranty.productCount }} {{ warranty.productCount === 1 ? 'product' : 'products' }}
              </div>
            </div>
            <span class="badge flex-shrink-0" :class="warranty.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ warranty.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div v-if="warranty.description" class="fs-13 mt-1 text-break">{{ warranty.description }}</div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="fs-12 text-gray-5">Created {{ formatDate(warranty.createdAt) }}</span>
            <div v-if="canEdit" class="row-actions">
              <button type="button" title="Edit" @click="openForm(warranty)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = warranty"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-certificate-2 fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter">No warranties match your filters.</template>
        <template v-else>No warranties yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Warranty pages" />
  </div>

  <WarrantyFormModal v-if="formOpen" :warranty="editing" @close="formOpen = false" @saved="onSaved" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Warranty"
    :item-name="deleting.name"
    :action="() => deleteWarranty(deleting!.id)"
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
  min-width: 240px;
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

.description-cell {
  max-width: 280px;
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
