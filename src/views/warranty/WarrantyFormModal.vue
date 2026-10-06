<script setup lang="ts">
// Add / edit dialog for a warranty. Pass `warranty` to edit, or null to add.
import { ref } from 'vue'
import { createWarranty, updateWarranty, type Warranty, type WarrantyDurationUnit } from '@/api/warranties'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ warranty: Warranty | null }>()
const emit = defineEmits<{ close: []; saved: [warranty: Warranty, isNew: boolean] }>()

const name = ref(props.warranty?.name ?? '')
const description = ref(props.warranty?.description ?? '')
const duration = ref(String(props.warranty?.duration ?? 1))
const durationUnit = ref<WarrantyDurationUnit>(props.warranty?.durationUnit ?? 'year')
const active = ref((props.warranty?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  const durationValue = Number(duration.value)
  const input = {
    name: name.value.trim(),
    description: description.value.trim() || null,
    duration: durationValue,
    durationUnit: durationUnit.value,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  if (!input.name) {
    error.value = 'Warranty name is required.'
    return
  }
  if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 1000) {
    error.value = 'Duration must be a whole number from 1 to 1000.'
    return
  }

  saving.value = true
  try {
    const saved = props.warranty ? await updateWarranty(props.warranty.id, input) : await createWarranty(input)
    emit('saved', saved, props.warranty === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the warranty'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="warranty ? 'Edit Warranty' : 'Add Warranty'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="warranty-name">Warranty <span class="text-danger">*</span></label>
          <input
            id="warranty-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="100"
            placeholder="e.g. 1 Year Limited Warranty"
            required
            autofocus
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="warranty-duration">Duration <span class="text-danger">*</span></label>
          <div class="input-group">
            <input
              id="warranty-duration"
              v-model="duration"
              type="number"
              class="form-control"
              min="1"
              max="1000"
              step="1"
              inputmode="numeric"
              required
            />
            <select v-model="durationUnit" class="form-select duration-unit" aria-label="Duration unit">
              <option value="day">Days</option>
              <option value="month">Months</option>
              <option value="year">Years</option>
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="warranty-description">Description</label>
          <textarea
            id="warranty-description"
            v-model="description"
            class="form-control"
            rows="3"
            maxlength="500"
            placeholder="What the warranty covers"
          ></textarea>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="warranty-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="warranty-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="warranty-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : warranty ? 'Save Changes' : 'Add Warranty' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.duration-unit {
  max-width: 130px;
}
</style>
