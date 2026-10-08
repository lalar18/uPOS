<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseDbDate } from '@/api/http'
import {
  deleteVariantAttribute,
  listVariantAttributes,
  type VariantAttribute,
  type VariantAttributeStatus,
} from '@/api/variantAttributes'
import { can } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import ListPager from '@/components/ListPager.vue'
import VariantAttributeFormModal from './VariantAttributeFormModal.vue'

const canEdit = computed(() => can('catalog.manage'))

// --- List, filters and paging ---

const items = ref<VariantAttribute[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const search = ref('')
const statusFilter = ref<VariantAttributeStatus | ''>('')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listVariantAttributes({
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
    if (requestId === latestRequest) {
      loadError.value = e instanceof Error ? e.message : 'Could not load variant attributes'
    }
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
const editing = ref<VariantAttribute | null>(null) // null while adding
const deleting = ref<VariantAttribute | null>(null)

function openForm(attribute: VariantAttribute | null) {
  editing.value = attribute
  formOpen.value = true
}

function onSaved(_attribute: VariantAttribute, isNew: boolean) {
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
      <h4>Variant Attributes</h4>
      <h6>Manage options like size and color</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button v-if="canEdit" type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Variant
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
            placeholder="Search name or value"
            aria-label="Search variant attributes"
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
              <th>Variant</th>
              <th>Values</th>
              <th>Created On</th>
              <th>Status</th>
              <th v-if="canEdit" class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="attribute in items" :key="attribute.id">
              <td class="fw-medium text-gray-9">{{ attribute.name }}</td>
              <td class="values-cell">
                <div class="value-tags">
                  <span v-for="value in attribute.values" :key="value" class="value-tag">{{ value }}</span>
                </div>
              </td>
              <td>{{ formatDate(attribute.createdAt) }}</td>
              <td>
                <span class="badge" :class="attribute.status === 'active' ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ attribute.status === 'active' ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td v-if="canEdit" class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(attribute)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = attribute">
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
        <div v-for="attribute in items" :key="attribute.id" class="list-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="fw-medium text-gray-9 text-break min-w-0">{{ attribute.name }}</div>
            <span class="badge flex-shrink-0" :class="attribute.status === 'active' ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ attribute.status === 'active' ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="value-tags mt-2">
            <span v-for="value in attribute.values" :key="value" class="value-tag">{{ value }}</span>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="fs-12 text-gray-5">Created {{ formatDate(attribute.createdAt) }}</span>
            <div v-if="canEdit" class="row-actions">
              <button type="button" title="Edit" @click="openForm(attribute)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = attribute"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-checklist fs-24 d-block mb-2"></i>
        <template v-if="search || statusFilter">No variant attributes match your filters.</template>
        <template v-else>No variant attributes yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="Variant attribute pages" />
  </div>

  <VariantAttributeFormModal v-if="formOpen" :attribute="editing" @close="formOpen = false" @saved="onSaved" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Variant Attribute"
    :item-name="deleting.name"
    :action="() => deleteVariantAttribute(deleting!.id)"
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

.table td.values-cell {
  white-space: normal;
  min-width: 240px;
}

.value-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.value-tag {
  padding: 2px 8px;
  border-radius: 6px;
  background: #f2f4f7;
  color: #212b36;
  font-size: 12px;
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
