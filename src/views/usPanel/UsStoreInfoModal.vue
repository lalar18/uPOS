<script setup lang="ts">
// Edits a store's name and contact details (the same fields as its Store Information page).
import { reactive, ref } from 'vue'
import type { StoreInput } from '@/api/store'
import { updateStore, type StoreDetail } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ store: StoreDetail }>()
const emit = defineEmits<{ close: []; saved: [store: StoreDetail] }>()

const form = reactive<StoreInput>({
  name: props.store.name,
  email: props.store.email ?? '',
  phone: props.store.phone ?? '',
  address: props.store.address ?? '',
  city: props.store.city ?? '',
  province: props.store.province ?? '',
  postalCode: props.store.postalCode ?? '',
  tin: props.store.tin ?? '',
})
const error = ref('')
const saving = ref(false)

const fields: { key: keyof StoreInput; label: string; maxlength: number; type?: string; wide?: boolean }[] = [
  { key: 'name', label: 'Store name', maxlength: 100 },
  { key: 'email', label: 'Email', maxlength: 254, type: 'email' },
  { key: 'phone', label: 'Phone', maxlength: 30, type: 'tel' },
  { key: 'tin', label: 'TIN', maxlength: 20 },
  { key: 'address', label: 'Address', maxlength: 255, wide: true },
  { key: 'city', label: 'City', maxlength: 100 },
  { key: 'province', label: 'Province', maxlength: 100 },
  { key: 'postalCode', label: 'Postal code', maxlength: 10 },
]

async function save() {
  error.value = ''
  if (!form.name.trim()) return void (error.value = 'Store name is required.')
  saving.value = true
  try {
    emit('saved', await updateStore(props.store.id, { ...form }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the store'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Edit Store Information" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="row g-3">
          <div v-for="field in fields" :key="field.key" :class="field.wide ? 'col-12' : 'col-md-6'">
            <label class="form-label" :for="`store-info-${field.key}`">
              {{ field.label }} <span v-if="field.key === 'name'" class="text-danger">*</span>
            </label>
            <input
              :id="`store-info-${field.key}`"
              v-model="form[field.key]"
              :type="field.type ?? 'text'"
              :maxlength="field.maxlength"
              class="form-control"
            />
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppModal>
</template>
