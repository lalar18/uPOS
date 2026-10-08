<script setup lang="ts">
// Sets a new password for a store user (e.g. an admin who's locked out). They're signed out everywhere.
import { ref } from 'vue'
import { resetStoreUserPassword, type StoreUser } from '@/api/usPanel'
import { MIN_PASSWORD_LENGTH } from '@/api/users'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ storeId: number; user: StoreUser }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const password = ref('')
const showPassword = ref(false)
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (password.value.length < MIN_PASSWORD_LENGTH) {
    error.value = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    return
  }
  saving.value = true
  try {
    await resetStoreUserPassword(props.storeId, props.user.id, password.value)
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reset the password'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Reset Password" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <p class="mb-3">
          Set a new password for <strong class="text-break">{{ user.fullName }}</strong> ({{ user.email }}). They'll be
          signed out and must use the new password next time.
        </p>
        <label class="form-label" for="us-reset-password">New Password <span class="text-danger">*</span></label>
        <input
          id="us-reset-password"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          class="form-control mb-2"
          maxlength="128"
          autocomplete="new-password"
          autofocus
        />
        <div class="form-check">
          <input id="us-reset-show" v-model="showPassword" class="form-check-input" type="checkbox" />
          <label class="form-check-label" for="us-reset-show">
            Show password · at least {{ MIN_PASSWORD_LENGTH }} characters
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : 'Reset Password' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
