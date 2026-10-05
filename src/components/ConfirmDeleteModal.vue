<script setup lang="ts">
// "Are you sure?" dialog. `action` does the delete; errors it throws are shown in the dialog.
import { ref } from 'vue'
import AppModal from './AppModal.vue'

const props = defineProps<{ title: string; itemName: string; action: () => Promise<unknown> }>()
const emit = defineEmits<{ close: []; deleted: [] }>()

const error = ref('')
const busy = ref(false)

async function confirm() {
  busy.value = true
  error.value = ''
  try {
    await props.action()
    emit('deleted')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not delete'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppModal :title="title" size="sm" @close="emit('close')">
    <div class="modal-body text-center">
      <span class="delete-icon mb-3"><i class="ti ti-trash"></i></span>
      <p class="mb-0">
        Delete <strong class="text-gray-9">{{ itemName }}</strong>? This can't be undone.
      </p>
      <div v-if="error" class="alert alert-danger py-2 mt-3 mb-0" role="alert">{{ error }}</div>
    </div>
    <div class="modal-footer justify-content-center">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">Cancel</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirm">
        {{ busy ? 'Deleting…' : 'Yes, Delete' }}
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
.delete-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ffeeec;
  color: #ff0000;
  font-size: 22px;
}
</style>
