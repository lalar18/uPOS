<script setup lang="ts">
// Sets a new password for another user. They're signed out everywhere and use the new one next time.
import { ref } from 'vue'
import { MIN_PASSWORD_LENGTH, resetUserPassword, type ManagedUser } from '@/api/users'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ user: ManagedUser }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (password.value.length < MIN_PASSWORD_LENGTH) {
    error.value = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'The passwords do not match.'
    return
  }
  saving.value = true
  try {
    await resetUserPassword(props.user.id, password.value)
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
          Set a new password for <strong class="text-break">{{ user.fullName }}</strong>. They'll be logged out
          and must use the new password next time.
        </p>
        <div class="mb-3">
          <label class="form-label" for="reset-password">New Password <span class="text-danger">*</span></label>
          <input
            id="reset-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="form-control"
            maxlength="128"
            autocomplete="new-password"
            autofocus
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="reset-password-confirm">Confirm Password <span class="text-danger">*</span></label>
          <input
            id="reset-password-confirm"
            v-model="confirmPassword"
            :type="showPassword ? 'text' : 'password'"
            class="form-control"
            maxlength="128"
            autocomplete="new-password"
          />
        </div>
        <div class="form-check">
          <input id="reset-show-password" v-model="showPassword" class="form-check-input" type="checkbox" />
          <label class="form-check-label" for="reset-show-password">
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
