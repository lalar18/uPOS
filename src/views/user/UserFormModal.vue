<script setup lang="ts">
// Add / edit dialog for a user. Pass `user` to edit, or null to add (which also sets a password).
import { computed, ref } from 'vue'
import { PERMISSION_GROUPS, type Role } from '@/api/roles'
import type { Subscription } from '@/api/subscription'
import { createUser, MIN_PASSWORD_LENGTH, updateUser, type ManagedUser } from '@/api/users'
import { currentUser } from '@/auth'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ user: ManagedUser | null; roles: Role[]; subscription: Subscription | null }>()
const emit = defineEmits<{ close: []; saved: [user: ManagedUser, isNew: boolean] }>()

// Admins can't change their own role or status (the API refuses too)
const isSelf = computed(() => props.user !== null && props.user.id === currentUser.value?.id)

const fullName = ref(props.user?.fullName ?? '')
const email = ref(props.user?.email ?? '')
// New users start on the first role that isn't Admin (Cashier, unless renamed)
const roleId = ref<number | null>(
  props.user?.role.id ?? props.roles.find((r) => !r.isAdmin)?.id ?? props.roles[0]?.id ?? null,
)
const selectedRole = computed(() => props.roles.find((r) => r.id === roleId.value) ?? null)

const PERMISSION_LABELS = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.label] as [string, string])),
)
const roleSummary = computed(() => {
  const role = selectedRole.value
  if (!role) return ''
  if (role.isAdmin) return 'Admins can do everything, including managing users, roles and settings.'
  if (role.permissions.length === 0) return 'This role can look things up but not change anything.'
  return `Can: ${role.permissions.map((p) => PERMISSION_LABELS.get(p)).join(', ')}.`
})

// The plan caps admins (e.g. Standard: 1 admin + 2 users); the API checks this too
const adminSeatsFull = computed(() => {
  const s = props.subscription
  if (!s || s.plan.maxAdmins === null || !selectedRole.value?.isAdmin || props.user?.role.isAdmin) return false
  return s.usage.admins >= s.plan.maxAdmins
})

const active = ref(props.user?.active ?? true)
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const error = ref('')
const saving = ref(false)

function validate(): string {
  if (!fullName.value.trim()) return 'Full name is required.'
  if (!email.value.trim()) return 'Email is required.'
  if (roleId.value === null) return 'Choose a role.'
  if (adminSeatsFull.value) return 'Your plan has no admin seats left. Choose another role.'
  if (!props.user) {
    if (password.value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    if (password.value !== confirmPassword.value) return 'The passwords do not match.'
  }
  return ''
}

async function save() {
  error.value = validate()
  if (error.value) return

  const input = { fullName: fullName.value, email: email.value, roleId: roleId.value!, active: active.value }
  saving.value = true
  try {
    const saved = props.user
      ? await updateUser(props.user.id, input)
      : await createUser({ ...input, password: password.value })
    emit('saved', saved, props.user === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the user'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="user ? 'Edit User' : 'Add User'" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="user-name">Full Name <span class="text-danger">*</span></label>
          <input id="user-name" v-model="fullName" type="text" class="form-control" maxlength="100" autofocus />
        </div>
        <div class="mb-3">
          <label class="form-label" for="user-email">Email <span class="text-danger">*</span></label>
          <input
            id="user-email"
            v-model="email"
            type="email"
            class="form-control"
            maxlength="254"
            autocomplete="off"
          />
          <div class="form-text">Used to log in.</div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="user-role">Role <span class="text-danger">*</span></label>
          <select id="user-role" v-model="roleId" class="form-select" :disabled="isSelf">
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <div class="form-text">
            <template v-if="isSelf">You can't change your own role.</template>
            <span v-else-if="adminSeatsFull" class="text-danger">
              Your {{ subscription?.plan.name }} plan has no admin seats left. Choose another role.
            </span>
            <template v-else>{{ roleSummary }}</template>
          </div>
        </div>

        <template v-if="!user">
          <div class="row g-3 mb-3">
            <div class="col-sm-6">
              <label class="form-label" for="user-password">Password <span class="text-danger">*</span></label>
              <input
                id="user-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                class="form-control"
                maxlength="128"
                autocomplete="new-password"
              />
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="user-password-confirm">Confirm <span class="text-danger">*</span></label>
              <input
                id="user-password-confirm"
                v-model="confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                class="form-control"
                maxlength="128"
                autocomplete="new-password"
              />
            </div>
          </div>
          <div class="form-check mb-3">
            <input id="user-show-password" v-model="showPassword" class="form-check-input" type="checkbox" />
            <label class="form-check-label" for="user-show-password">
              Show password · at least {{ MIN_PASSWORD_LENGTH }} characters
            </label>
          </div>
        </template>

        <div class="d-flex align-items-start justify-content-between gap-3">
          <div>
            <label class="form-label mb-0" for="user-status">Status</label>
            <div class="form-text mt-0">
              {{ isSelf ? "You can't deactivate yourself." : 'Inactive users cannot log in.' }}
            </div>
          </div>
          <div class="form-check form-switch mb-0 flex-shrink-0">
            <input
              id="user-status"
              v-model="active"
              class="form-check-input"
              type="checkbox"
              role="switch"
              :disabled="isSelf"
            />
            <label class="form-check-label" for="user-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : user ? 'Save Changes' : 'Add User' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
