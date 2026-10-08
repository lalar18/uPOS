<script setup lang="ts">
// Add / edit dialog for a role and its permissions. Pass `role` to edit, or null to add.
import { computed, ref } from 'vue'
import { createRole, PERMISSION_GROUPS, updateRole, type Permission, type Role } from '@/api/roles'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ role: Role | null }>()
const emit = defineEmits<{ close: []; saved: [role: Role, isNew: boolean] }>()

const name = ref(props.role?.name ?? '')
const selected = ref(new Set<Permission>(props.role?.permissions ?? []))
const error = ref('')
const saving = ref(false)

function toggle(permission: Permission, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(permission)
  else next.delete(permission)
  selected.value = next
}

type Group = (typeof PERMISSION_GROUPS)[number]
const groupKeys = (group: Group): Permission[] => group.permissions.map((p) => p.key)
const groupAllOn = (group: Group) => groupKeys(group).every((k) => selected.value.has(k))

function toggleGroup(group: Group, on: boolean) {
  const next = new Set(selected.value)
  for (const key of groupKeys(group)) {
    if (on) next.add(key)
    else next.delete(key)
  }
  selected.value = next
}

const selectedCount = computed(() => selected.value.size)

async function save() {
  error.value = ''
  const input = { name: name.value.trim(), permissions: [...selected.value] }
  if (!input.name) {
    error.value = 'Role name is required.'
    return
  }

  saving.value = true
  try {
    const saved = props.role ? await updateRole(props.role.id, input) : await createRole(input)
    emit('saved', saved, props.role === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the role'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="role ? 'Edit Role' : 'Add Role'" size="lg" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="role-name">Role Name <span class="text-danger">*</span></label>
          <input
            id="role-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="50"
            placeholder="e.g. Store Manager"
            required
            autofocus
          />
        </div>

        <div class="d-flex align-items-baseline justify-content-between gap-2 mb-2">
          <span class="form-label mb-0">Permissions</span>
          <span class="fs-12 text-gray-5">{{ selectedCount }} selected · everyone can view records</span>
        </div>

        <fieldset v-for="group in PERMISSION_GROUPS" :key="group.title" class="permission-group">
          <legend class="d-flex align-items-center justify-content-between gap-2">
            <span>{{ group.title }}</span>
            <span class="form-check mb-0 fs-12 fw-normal">
              <input
                :id="`group-${group.title}`"
                class="form-check-input"
                type="checkbox"
                :checked="groupAllOn(group)"
                @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)"
              />
              <label class="form-check-label" :for="`group-${group.title}`">Allow all</label>
            </span>
          </legend>
          <div class="row g-2">
            <div v-for="p in group.permissions" :key="p.key" class="col-sm-6">
              <div class="form-check mb-0">
                <input
                  :id="`perm-${p.key}`"
                  class="form-check-input"
                  type="checkbox"
                  :checked="selected.has(p.key)"
                  @change="toggle(p.key, ($event.target as HTMLInputElement).checked)"
                />
                <label class="form-check-label" :for="`perm-${p.key}`">
                  <span class="d-block text-gray-9">{{ p.label }}</span>
                  <span v-if="p.hint" class="d-block fs-12 text-gray-5">{{ p.hint }}</span>
                </label>
              </div>
            </div>
          </div>
        </fieldset>

        <p class="fs-12 text-gray-5 mb-0">
          Managing users, roles and the subscription is reserved for the Admin role.
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : role ? 'Save Changes' : 'Add Role' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.permission-group {
  border: 1px solid #e6eaed;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.permission-group legend {
  float: none;
  width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: #212b36;
  margin-bottom: 10px;
}
</style>
