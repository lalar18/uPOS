<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { deleteBrand, listBrands, type Brand, type BrandStatus } from '@/api/brands'
import { parseDbDate } from '@/api/http'
import { currentUser } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import BrandFormModal from './BrandFormModal.vue'

const isAdmin = computed(() => currentUser.value?.role === 'admin')

// --- List, filters and paging ---

const PAGE_SIZES = [10, 25, 50]

const items = ref<Brand[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<BrandStatus | ''>('')
const page = ref(1)
const pageSize = ref(10)

const pageCount = computed(() => Math.max(Math.ceil(total.value / pageSize.value), 1))
const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

/** Page numbers to show, with null for a "…" gap: 1 … 4 5 6 … 10 */
const pageButtons = computed<(number | null)[]>(() => {
  const last = pageCount.value
  const current = page.value
  const pages = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((p) => p >= 1 && p <= last)
    .sort((a, b) => a - b)
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1]! > 1 ? [null, p] : [p]))
})

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listBrands({
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
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load brands'
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
const editing = ref<Brand | null>(null) // null while adding
const deleting = ref<Brand | null>(null)

function openForm(brand: Brand | null) {
  editing.value = brand
  formOpen.value = true
}

function onSaved(_brand: Brand, isNew: boolean) {
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
      <h4>Brands</h4>
      <h6>Manage your brands</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="isAdmin" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Brand
      </button>
    </div>
  </div>

  <div class="card">
    <!-- Search and filter -->
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="search-set">
        <div class="search-input">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input v-model="search" type="search" class="form-control" placeholder="Search" aria-label="Search brands" />
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
              <th>Brand</th>
              <th>Created On</th>
              <th>Status</th>
              <th v-if="isAdmin" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="brand in items" :key="brand.id">
              <td>
                <div class="d-flex align-items-center gap-2">
                  <span class="brand-logo">
                    <img v-if="brand.logoUrl" :src="brand.logoUrl" :alt="brand.name" loading="lazy" />
                    <i v-else class="ti ti-triangles"></i>
                  </span>
                  <span class="fw-medium text-gray-9">{{ brand.name }}</span>
                </div>
              </td>
              <td>{{ formatDate(brand.createdAt) }}</td>
              <td>
                <span class="badge" :class="brand.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ brand.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="isAdmin" class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(brand)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = brand"><i class="ti ti-trash"></i></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones) -->
      <div class="d-md-none" :class="{ 'is-loading': loading }">
        <div v-for="brand in items" :key="brand.id" class="brand-card">
          <div class="d-flex justify-content-between align-items-center gap-2">
            <div class="d-flex align-items-center gap-2 min-w-0">
              <span class="brand-logo">
                <img v-if="brand.logoUrl" :src="brand.logoUrl" :alt="brand.name" loading="lazy" />
                <i v-else class="ti ti-triangles"></i>
              </span>
              <div class="fw-medium text-gray-9 text-break min-w-0">{{ brand.name }}</div>
            </div>
            <span class="badge flex-shrink-0" :class="brand.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ brand.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="fs-12 text-gray-5">Created {{ formatDate(brand.createdAt) }}</span>
            <div v-if="isAdmin" class="row-actions">
              <button type="button" title="Edit" @click="openForm(brand)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = brand"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-triangles fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter">No brands match your filters.</template>
        <template v-else>No brands yet.</template>
      </div>
    </div>

    <!-- Paging -->
    <div class="card-footer d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="d-flex align-items-center gap-2 fs-14">
        <span class="text-nowrap">Rows per page</span>
        <select v-model.number="pageSize" class="form-select form-select-sm page-size" aria-label="Rows per page">
          <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
        </select>
        <span class="text-gray-5 text-nowrap">{{ rangeStart }}–{{ rangeEnd }} of {{ total }}</span>
      </div>
      <nav aria-label="Brand pages">
        <ul class="pagination pagination-sm mb-0">
          <li class="page-item" :class="{ disabled: page <= 1 }">
            <button type="button" class="page-link" aria-label="Previous page" @click="page--">
              <i class="ti ti-chevron-left"></i>
            </button>
          </li>
          <li
            v-for="(p, i) in pageButtons"
            :key="p ?? `gap-${i}`"
            class="page-item"
            :class="{ active: p === page, disabled: p === null }"
          >
            <span v-if="p === null" class="page-link">…</span>
            <button v-else type="button" class="page-link" @click="page = p">{{ p }}</button>
          </li>
          <li class="page-item" :class="{ disabled: page >= pageCount }">
            <button type="button" class="page-link" aria-label="Next page" @click="page++">
              <i class="ti ti-chevron-right"></i>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  </div>

  <BrandFormModal v-if="formOpen" :brand="editing" @close="formOpen = false" @saved="onSaved" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Brand"
    :item-name="deleting.name"
    :action="() => deleteBrand(deleting!.id)"
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

.page-size {
  width: auto;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
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

.brand-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 18px;
  overflow: hidden;
}

.brand-logo img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.brand-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.brand-card:last-child {
  border-bottom: 0;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

.pagination .page-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border-radius: 50% !important;
  border: 0;
  margin: 0 2px;
  color: #646b72;
  background: transparent;
}

.pagination .page-item.active .page-link {
  background: #fe9f43;
  color: #ffffff;
}

.pagination .page-item.disabled .page-link {
  opacity: 0.4;
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
