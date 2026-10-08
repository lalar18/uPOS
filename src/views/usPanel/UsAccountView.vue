<script setup lang="ts">
// The signed-in super admin's account: who they are, and changing their password.
import { ref } from 'vue'
import { changeSuperAdminPassword } from '@/api/usPanel'
import { MIN_PASSWORD_LENGTH } from '@/api/users'
import { currentSuperAdmin } from '@/usPanelAuth'

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const error = ref('')
const success = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  success.value = ''
  if (!currentPassword.value) return void (error.value = 'Enter your current password.')
  if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
    return void (error.value = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (newPassword.value !== confirmPassword.value) return void (error.value = 'The new passwords do not match.')
  saving.value = true
  try {
    await changeSuperAdminPassword(currentPassword.value, newPassword.value)
    currentPassword.value = newPassword.value = confirmPassword.value = ''
    success.value = 'Password changed. Your other devices were signed out.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not change your password'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Account</h4>
      <h6>Your US Panel sign-in</h6>
    </div>
  </div>

  <div class="row g-3">
    <div class="col-lg-5">
      <div class="card h-100 mb-0">
        <div class="card-header"><h5 class="card-title mb-0">Details</h5></div>
        <div class="card-body">
          <div class="fs-12 text-gray-5">Name</div>
          <div class="fw-medium mb-3">{{ currentSuperAdmin?.fullName }}</div>
          <div class="fs-12 text-gray-5">Email</div>
          <div class="fw-medium mb-3 text-break">{{ currentSuperAdmin?.email }}</div>
          <div class="fs-12 text-gray-5">Role</div>
          <div class="fw-medium">Super admin</div>
        </div>
      </div>
    </div>
    <div class="col-lg-7">
      <div class="card h-100 mb-0">
        <div class="card-header"><h5 class="card-title mb-0">Change Password</h5></div>
        <form class="card-body" novalidate @submit.prevent="save">
          <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
          <div v-if="success" class="alert alert-success py-2" role="status">{{ success }}</div>
          <div class="mb-3">
            <label class="form-label" for="us-current-password">Current password</label>
            <input
              id="us-current-password"
              v-model="currentPassword"
              :type="showPassword ? 'text' : 'password'"
              class="form-control"
              autocomplete="current-password"
            />
          </div>
          <div class="row g-3 mb-3">
            <div class="col-sm-6">
              <label class="form-label" for="us-new-password">New password</label>
              <input
                id="us-new-password"
                v-model="newPassword"
                :type="showPassword ? 'text' : 'password'"
                maxlength="128"
                class="form-control"
                autocomplete="new-password"
              />
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="us-confirm-password">Confirm new password</label>
              <input
                id="us-confirm-password"
                v-model="confirmPassword"
                :type="showPassword ? 'text' : 'password'"
                maxlength="128"
                class="form-control"
                autocomplete="new-password"
              />
            </div>
          </div>
          <div class="form-check mb-3">
            <input id="us-show-passwords" v-model="showPassword" class="form-check-input" type="checkbox" />
            <label class="form-check-label" for="us-show-passwords">
              Show passwords · at least {{ MIN_PASSWORD_LENGTH }} characters
            </label>
          </div>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Change Password' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
