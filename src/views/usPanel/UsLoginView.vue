<script setup lang="ts">
// Sign-in for super admins (US Panel). Store users sign in at /login instead.
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginSuperAdmin } from '@/usPanelAuth'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const submitting = ref(false)

async function handleSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await loginSuperAdmin(email.value, password.value)
    // Only back into the panel, never to an outside or store page
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/us-panel/')
        ? route.query.redirect
        : '/us-panel'
    router.replace(redirect)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="main-wrapper">
    <div class="account-content">
      <div class="login-wrapper login-centered">
        <div class="login-content login-card">
          <form @submit.prevent="handleSubmit">
            <div class="login-userset">
              <div class="login-logo logo-normal">
                <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
              </div>

              <div class="login-userheading">
                <span class="badge bg-dark mb-2"><i class="ti ti-shield-lock me-1"></i>US Panel</span>
                <h3>Super Admin Sign In</h3>
                <h4 class="fs-16">For USystems staff only. Store users sign in on the store login page.</h4>
              </div>

              <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

              <div class="mb-3">
                <label class="form-label" for="us-email">Email <span class="text-danger">*</span></label>
                <div class="input-group">
                  <input
                    id="us-email"
                    v-model="email"
                    type="email"
                    class="form-control border-end-0"
                    autocomplete="username"
                    required
                  />
                  <span class="input-group-text border-start-0">
                    <i class="ti ti-mail"></i>
                  </span>
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label" for="us-password">Password <span class="text-danger">*</span></label>
                <div class="pass-group">
                  <input
                    id="us-password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    class="pass-input form-control"
                    autocomplete="current-password"
                    required
                  />
                  <span
                    class="ti toggle-password text-gray-9"
                    :class="showPassword ? 'ti-eye' : 'ti-eye-off'"
                    @click="showPassword = !showPassword"
                  ></span>
                </div>
              </div>

              <div class="form-login">
                <button type="submit" class="btn btn-dark w-100" :disabled="submitting">
                  {{ submitting ? 'Signing in…' : 'Sign In' }}
                </button>
              </div>

              <div class="my-4 d-flex justify-content-center align-items-center copyright-text">
                <p>Copyright &copy; {{ new Date().getFullYear() }} USystems POS</p>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-wrapper.login-centered {
  position: relative;
  height: auto;
  min-height: 100vh;
  overflow: hidden auto;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #1b2850;
}

.login-wrapper.login-centered .login-content.login-card {
  position: relative;
  width: 100%;
  max-width: 440px;
  height: auto;
  padding: 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
  overflow: visible;
}

.login-wrapper.login-centered .login-content.login-card form {
  width: 100%;
}

.login-wrapper.login-centered .login-userset {
  margin-top: 0;
}

.login-wrapper.login-centered .login-userset .my-4 {
  margin-top: 24px !important;
  margin-bottom: 0 !important;
}

@media (max-width: 575.98px) {
  .login-wrapper.login-centered .login-content.login-card {
    padding: 24px 20px;
  }
}
</style>
