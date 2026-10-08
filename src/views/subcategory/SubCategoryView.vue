<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseDbDate } from '@/api/http'
import { getProductOptions, type ProductOption } from '@/api/products'
import {
  deleteSubcategory,
  listSubcategories,
  type Subcategory,
  type SubcategoryStatus,
} from '@/api/subcategories'
import { can } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import ListPager from '@/components/ListPager.vue'
import SubCategoryFormModal from './SubCategoryFormModal.vue'

const canEdit = computed(() => can('catalog.manage'))

// Every category in the store, for the filter and the form. The list still works if these fail to load.
const categories = ref<ProductOption[]>([])
getProductOptions()
  .then((result) => (categories.value = result.categories))
  .catch(() => {})

// --- List, filters and paging ---

const items = ref<Subcategory[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<SubcategoryStatus | ''>('')
const categoryFilter = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)

const hasFilters = computed(() => search.value !== '' || statusFilter.value !== '' || categoryFilter.value !== null)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listSubcategories({
      search: search.value.trim(),
      status: statusFilter.value,
      categoryId: categoryFilter.value,
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
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load sub categories'
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
watch([statusFilter, categoryFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

const dateFormat = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))

// --- Dialogs ---

const formOpen = ref(false)
const editing = ref<Subcategory | null>(null) // null while adding
const deleting = ref<Subcategory | null>(null)

function openForm(subcategory: Subcategory | null) {
  editing.value = subcategory
  formOpen.value = true
}

function onSaved(_subcategory: Subcategory, isNew: boolean) {
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
      <h4>Sub Category</h4>
      <h6>Manage your sub categories</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="canEdit" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Sub Category
      </button>
    </div>
  </div>

  <div class="card">
    <!-- Search and filters -->
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div class="search-set">
        <div class="search-input">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Search"
            aria-label="Search sub categories"
          />
        </div>
      </div>
      <div class="filters d-flex flex-wrap gap-2">
        <select v-model="categoryFilter" class="form-select" aria-label="Filter by category">
          <option :value="null">All categories</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <select v-model="statusFilter" class="form-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (tablets and up) -->
      <div class="table-responsive d-none d-md-block">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Sub Category</th>
              <th>Category</th>
              <th>Description</th>
              <th>Created On</th>
              <th>Status</th>
              <th v-if="canEdit" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="subcategory in items" :key="subcategory.id">
              <td class="fw-medium text-gray-9">{{ subcategory.name }}</td>
              <td>{{ subcategory.category.name }}</td>
              <td class="description">{{ subcategory.description ?? '—' }}</td>
              <td>{{ formatDate(subcategory.createdAt) }}</td>
              <td>
                <span class="badge" :class="subcategory.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ subcategory.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="canEdit" class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(subcategory)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = subcategory">
                    <i class="ti ti-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones) -->
      <div class="d-md-none" :class="{ 'is-loading': loading }">
        <div v-for="subcategory in items" :key="subcategory.id" class="subcategory-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ subcategory.name }}</div>
              <div class="fs-12 text-gray-5 text-break">{{ subcategory.category.name }}</div>
            </div>
            <span class="badge flex-shrink-0" :class="subcategory.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ subcategory.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div v-if="subcategory.description" class="fs-13 mt-1 text-break">{{ subcategory.description }}</div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="fs-12 text-gray-5">Created {{ formatDate(subcategory.createdAt) }}</span>
            <div v-if="canEdit" class="row-actions">
              <button type="button" title="Edit" @click="openForm(subcategory)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = subcategory"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-carousel-vertical fs-24 d-block mb-2"></i>
        <template v-if="hasFilters">No sub categories match your filters.</template>
        <template v-else>No sub categories yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Sub category pages" />
  </div>

  <SubCategoryFormModal
    v-if="formOpen"
    :subcategory="editing"
    :categories="categories"
    @close="formOpen = false"
    @saved="onSaved"
  />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Sub Category"
    :item-name="deleting.name"
    :action="() => deleteSubcategory(deleting!.id)"
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

.filters .form-select {
  width: auto;
  min-width: 150px;
  max-width: 200px;
}

.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.table td.description {
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

.subcategory-card {
  padding: 14px 16px;
  border-bottom: 1px solid #e6eaed;
}

.subcategory-card:last-child {
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
  .filters {
    width: 100%;
    min-width: 0;
  }

  .filters .form-select {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
  }

  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
