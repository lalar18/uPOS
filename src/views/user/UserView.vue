<script setup lang="ts">
// Users of this store (Admin role only; the router keeps everyone else out).
import { computed, ref, watch } from 'vue'
import { parseDbDate } from '@/api/http'
import { listRoles, type Role } from '@/api/roles'
import { describeSeats, getSubscription, type Subscription } from '@/api/subscription'
import { deleteUser, listUsers, type ManagedUser } from '@/api/users'
import { currentUser } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import ListPager from '@/components/ListPager.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import ResetPasswordModal from './ResetPasswordModal.vue'
import UserFormModal from './UserFormModal.vue'

const isSelf = (user: ManagedUser) => user.id === currentUser.value?.id

// --- List, filters and paging ---

const items = ref<ManagedUser[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const notice = ref('') // e.g. "Password reset for …"

const search = ref('')
const roleFilter = ref<number | null>(null)
const statusFilter = ref<'active' | 'inactive' | ''>('')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listUsers({
      search: search.value.trim(),
      roleId: roleFilter.value,
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
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load users'
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
watch([roleFilter, statusFilter, pageSize], resetToFirstPage)
watch(page, load)
load()

// --- Roles (for the filter and form) and the plan's user seats ---

const roles = ref<Role[]>([])
const subscription = ref<Subscription | null>(null)

async function loadPlan() {
  try {
    subscription.value = await getSubscription()
  } catch {
    subscription.value = null // the API still enforces the limit
  }
}

listRoles()
  .then((items) => (roles.value = items))
  .catch((e) => (loadError.value = e instanceof Error ? e.message : 'Could not load roles'))
loadPlan()

const seatsFull = computed(() => {
  const s = subscription.value
  return s !== null && s.usage.users >= s.plan.maxUsers
})

const dateFormat = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))

// --- Dialogs ---

const formOpen = ref(false)
const editing = ref<ManagedUser | null>(null) // null while adding
const resetting = ref<ManagedUser | null>(null)
const deleting = ref<ManagedUser | null>(null)

function openForm(user: ManagedUser | null) {
  notice.value = ''
  editing.value = user
  formOpen.value = true
}

function onSaved(user: ManagedUser) {
  formOpen.value = false
  // The header shows your own name
  if (currentUser.value && isSelf(user)) {
    currentUser.value.fullName = user.fullName
    currentUser.value.email = user.email
  }
  load()
  loadPlan()
}

function onPasswordReset() {
  notice.value = `Password reset for ${resetting.value?.fullName ?? 'the user'}.`
  resetting.value = null
}

function onDeleted() {
  deleting.value = null
  load()
  loadPlan()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Users</h4>
      <h6>Manage who can log in to your store</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <RouterLink :to="{ name: 'roles' }" class="btn btn-white border">
        <i class="ti ti-shield-lock me-1"></i>Roles
      </RouterLink>
      <button type="button" class="btn btn-primary" :disabled="seatsFull" @click="openForm(null)">
        <i class="ti ti-circle-plus me-1"></i>Add User
      </button>
    </div>
  </div>

  <!-- Seats on the store's subscription plan -->
  <div
    v-if="subscription"
    class="alert py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"
    :class="seatsFull ? 'alert-warning' : 'alert-light border'"
    role="status"
  >
    <span>
      <strong>{{ subscription.usage.users }} of {{ subscription.plan.maxUsers }}</strong> users on the
      {{ subscription.plan.name }} plan ({{ describeSeats(subscription.plan) }}).
      <template v-if="seatsFull">Delete a user or upgrade your plan to add another.</template>
    </span>
    <RouterLink :to="{ name: 'subscription' }" class="fw-medium">View plan</RouterLink>
  </div>

  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
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
            placeholder="Search name or email"
            aria-label="Search users"
          />
        </div>
      </div>
      <div class="filters d-flex gap-2">
        <select v-model="roleFilter" class="form-select" aria-label="Filter by role">
          <option :value="null">All roles</option>
          <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
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
              <th>User</th>
              <th>Role</th>
              <th>Created On</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in items" :key="user.id">
              <td>
                <div class="d-flex align-items-center gap-2">
                  <UserAvatar :user="user" :size="36" radius="50%" />
                  <div class="min-w-0">
                    <div class="fw-medium text-gray-9">
                      {{ user.fullName }}
                      <span v-if="isSelf(user)" class="badge bg-light text-dark ms-1">You</span>
                    </div>
                    <div class="fs-12 text-gray-5">{{ user.email }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="badge" :class="user.role.isAdmin ? 'bg-primary' : 'bg-secondary'">
                  {{ user.role.name }}
                </span>
              </td>
              <td>{{ formatDate(user.createdAt) }}</td>
              <td>
                <span class="badge" :class="user.active ? 'bg-success' : 'bg-danger'">
                  <i class="ti ti-point-filled me-1"></i>{{ user.active ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td class="text-end">
                <div class="row-actions">
                  <button type="button" title="Edit" @click="openForm(user)"><i class="ti ti-edit"></i></button>
                  <button
                    v-if="!isSelf(user)"
                    type="button"
                    title="Reset password"
                    @click="(notice = ''), (resetting = user)"
                  >
                    <i class="ti ti-key"></i>
                  </button>
                  <button v-if="!isSelf(user)" type="button" title="Delete" @click="deleting = user">
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
        <div v-for="user in items" :key="user.id" class="list-card">
          <div class="d-flex align-items-start gap-2">
            <UserAvatar :user="user" :size="40" radius="50%" />
            <div class="min-w-0 flex-grow-1">
              <div class="fw-medium text-gray-9 text-break">
                {{ user.fullName }}
                <span v-if="isSelf(user)" class="badge bg-light text-dark ms-1">You</span>
              </div>
              <div class="fs-12 text-gray-5 text-break">{{ user.email }}</div>
            </div>
            <span class="badge flex-shrink-0" :class="user.active ? 'bg-success' : 'bg-danger'">
              <i class="ti ti-point-filled me-1"></i>{{ user.active ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="d-flex justify-content-between align-items-center gap-2 mt-2">
            <span class="badge" :class="user.role.isAdmin ? 'bg-primary' : 'bg-secondary'">
              {{ user.role.name }}
            </span>
            <div class="row-actions">
              <button type="button" title="Edit" @click="openForm(user)"><i class="ti ti-edit"></i></button>
              <button
                v-if="!isSelf(user)"
                type="button"
                title="Reset password"
                @click="(notice = ''), (resetting = user)"
              >
                <i class="ti ti-key"></i>
              </button>
              <button v-if="!isSelf(user)" type="button" title="Delete" @click="deleting = user">
                <i class="ti ti-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-users fs-24 d-block mb-2"></i>
        <template v-if="search || roleFilter || statusFilter">No users match your filters.</template>
        <template v-else>No users yet.</template>
      </div>
    </div>

    <ListPager v-model:page="page" v-model:page-size="pageSize" :total="total" label="User pages" />
  </div>

  <UserFormModal
    v-if="formOpen"
    :user="editing"
    :roles="roles"
    :subscription="subscription"
    @close="formOpen = false"
    @saved="onSaved"
  />
  <ResetPasswordModal v-if="resetting" :user="resetting" @close="resetting = null" @saved="onPasswordReset" />
  <ConfirmDeleteModal
    v-if="deleting"
    title="Delete User"
    :item-name="deleting.fullName"
    :action="() => deleteUser(deleting!.id)"
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

.filters .form-select {
  width: auto;
  min-width: 140px;
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
  .filters {
    width: 100%;
    min-width: 0;
  }

  .filters .form-select {
    flex: 1;
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
