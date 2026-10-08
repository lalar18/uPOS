<script setup lang="ts">
// Roles of this store and what each may do (Admin role only; the router keeps everyone else out).
import { ref } from 'vue'
import { ALL_PERMISSIONS, deleteRole, listRoles, PERMISSION_GROUPS, type Role } from '@/api/roles'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import RoleFormModal from './RoleFormModal.vue'

const items = ref<Role[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    items.value = await listRoles()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load roles'
  } finally {
    loading.value = false
  }
}
load()

/** Group titles the role has at least one permission in, e.g. "Inventory, Sales" */
function summary(role: Role): string {
  if (role.isAdmin) return 'Everything, including users, roles and subscription'
  if (role.permissions.length === 0) return 'View only'
  return PERMISSION_GROUPS.filter((g) => g.permissions.some((p) => role.permissions.includes(p.key)))
    .map((g) => g.title)
    .join(', ')
}

const countLabel = (role: Role) =>
  role.isAdmin ? 'All' : `${role.permissions.length} of ${ALL_PERMISSIONS.length}`
const usersLabel = (role: Role) => `${role.userCount} user${role.userCount === 1 ? '' : 's'}`

// --- Dialogs ---

const formOpen = ref(false)
const editing = ref<Role | null>(null) // null while adding
const deleting = ref<Role | null>(null)

function openForm(role: Role | null) {
  editing.value = role
  formOpen.value = true
}

function onSaved() {
  formOpen.value = false
  load()
}

function onDeleted() {
  deleting.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Roles &amp; Permissions</h4>
      <h6>Choose what each role in your store can do</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button type="button" class="btn btn-primary" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add Role
      </button>
    </div>
  </div>

  <div class="card">
    <div class="card-body p-0">
      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <!-- Table (tablets and up) -->
      <div class="table-responsive d-none d-md-block">
        <table class="table mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Role</th>
              <th>Can change</th>
              <th>Permissions</th>
              <th>Users</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="role in items" :key="role.id">
              <td>
                <span class="fw-medium text-gray-9">{{ role.name }}</span>
                <span v-if="role.isAdmin" class="badge bg-primary ms-2">Built-in</span>
              </td>
              <td class="text-wrap">{{ summary(role) }}</td>
              <td>{{ countLabel(role) }}</td>
              <td>{{ usersLabel(role) }}</td>
              <td class="text-end">
                <div v-if="!role.isAdmin" class="row-actions">
                  <button type="button" title="Edit" @click="openForm(role)"><i class="ti ti-edit"></i></button>
                  <button type="button" title="Delete" @click="deleting = role"><i class="ti ti-trash"></i></button>
                </div>
                <span v-else class="fs-12 text-gray-5">Can't be changed</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cards (phones) -->
      <div class="d-md-none" :class="{ 'is-loading': loading }">
        <div v-for="role in items" :key="role.id" class="list-card">
          <div class="d-flex align-items-start justify-content-between gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">
                {{ role.name }}
                <span v-if="role.isAdmin" class="badge bg-primary ms-1">Built-in</span>
              </div>
              <div class="fs-12 text-gray-5">{{ summary(role) }}</div>
            </div>
            <div v-if="!role.isAdmin" class="row-actions flex-shrink-0">
              <button type="button" title="Edit" @click="openForm(role)"><i class="ti ti-edit"></i></button>
              <button type="button" title="Delete" @click="deleting = role"><i class="ti ti-trash"></i></button>
            </div>
          </div>
          <div class="fs-12 text-gray-5 mt-2">{{ countLabel(role) }} permissions · {{ usersLabel(role) }}</div>
        </div>
      </div>

      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-shield-lock fs-24 d-block mb-2"></i>No roles yet.
      </div>
    </div>
  </div>

  <RoleFormModal v-if="formOpen" :role="editing" @close="formOpen = false" @saved="onSaved" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete Role"
    :item-name="deleting.name"
    :action="() => deleteRole(deleting!.id)"
    @close="deleting = null"
    @deleted="onDeleted"
  />
</template>

<style scoped>
.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.table td.text-wrap {
  white-space: normal;
  min-width: 220px;
}

.badge {
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
  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary {
    flex: 1;
  }
}
</style>
