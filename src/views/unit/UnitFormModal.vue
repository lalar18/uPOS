<script setup lang="ts">
// Add / edit dialog for a unit. Pass `unit` to edit, or null to add.
import { ref } from 'vue'
import { createUnit, updateUnit, type Unit } from '@/api/units'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ unit: Unit | null }>()
const emit = defineEmits<{ close: []; saved: [unit: Unit, isNew: boolean] }>()

const name = ref(props.unit?.name ?? '')
const shortName = ref(props.unit?.shortName ?? '')
const allowDecimal = ref(props.unit?.allowDecimal ?? false)
const active = ref((props.unit?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  const input = {
    name: name.value.trim(),
    shortName: shortName.value.trim(),
    allowDecimal: allowDecimal.value,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  if (!input.name || !input.shortName) {
    error.value = 'Unit name and short name are required.'
    return
  }

  saving.value = true
  try {
    const saved = props.unit ? await updateUnit(props.unit.id, input) : await createUnit(input)
    emit('saved', saved, props.unit === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the unit'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="unit ? 'Edit Unit' : 'Add Unit'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="unit-name">Unit <span class="text-danger">*</span></label>
          <input
            id="unit-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="50"
            placeholder="e.g. Kilogram"
            required
            autofocus
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="unit-short-name">Short Name <span class="text-danger">*</span></label>
          <input
            id="unit-short-name"
            v-model="shortName"
            type="text"
            class="form-control"
            maxlength="10"
            placeholder="e.g. kg"
            required
          />
          <div class="form-text">Shown next to quantities, like "12 kg".</div>
        </div>
        <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
          <div>
            <label class="form-label mb-0" for="unit-decimal">Allow decimals</label>
            <div class="form-text mt-0">For things sold by weight or volume, like 1.5 kg.</div>
          </div>
          <div class="form-check form-switch mb-0">
            <input id="unit-decimal" v-model="allowDecimal" class="form-check-input" type="checkbox" role="switch" />
          </div>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="unit-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="unit-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="unit-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : unit ? 'Save Changes' : 'Add Unit' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
