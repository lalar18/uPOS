<script setup lang="ts">
// "Are you sure?" for US Panel actions. `action` does the work; errors it throws are shown here.
import { ref } from 'vue'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => Promise<unknown> }>()
const emit = defineEmits<{ close: []; done: [] }>()

const error = ref('')
const busy = ref(false)

async function confirm() {
  busy.value = true
  error.value = ''
  try {
    await props.action()
    emit('done')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Something went wrong'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppModal :title="title" size="sm" @close="emit('close')">
    <div class="modal-body">
      <p class="mb-0">{{ message }}</p>
      <div v-if="error" class="alert alert-danger py-2 mt-3 mb-0" role="alert">{{ error }}</div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">Cancel</button>
      <button type="button" class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" :disabled="busy" @click="confirm">
        {{ busy ? 'Working…' : confirmLabel }}
      </button>
    </div>
  </AppModal>
</template>
