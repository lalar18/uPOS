<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '@/auth'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const rememberMe = ref(false)
const showPassword = ref(false)
const error = ref('')
const submitting = ref(false)

async function handleSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await login(email.value, password.value, rememberMe.value)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
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
                <img src="/assets/img/logo.svg" alt="uPOS" />
              </div>
              <a href="#" class="login-logo logo-white">
                <img src="/assets/img/logo-white.svg" alt="uPOS" />
              </a>

              <div class="login-userheading">
                <h3>Sign In</h3>
                <h4 class="fs-16">Access the uPOS panel using your email and password.</h4>
              </div>

              <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

              <div class="mb-3">
                <label class="form-label">Email <span class="text-danger">*</span></label>
                <div class="input-group">
                  <input v-model="email" type="email" class="form-control border-end-0" autocomplete="email" required />
                  <span class="input-group-text border-start-0">
                    <i class="ti ti-mail"></i>
                  </span>
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label">Password <span class="text-danger">*</span></label>
                <div class="pass-group">
                  <input
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

              <div class="form-login authentication-check">
                <div class="row">
                  <div class="col-12 d-flex align-items-center justify-content-between">
                    <div class="custom-control custom-checkbox">
                      <label class="checkboxs ps-4 mb-0 pb-0 line-height-1 fs-16 text-gray-6">
                        <input v-model="rememberMe" type="checkbox" class="form-control" />
                        <span class="checkmarks"></span>Remember me
                      </label>
                    </div>
                    <div class="text-end">
                      <a class="text-orange fs-16 fw-medium" href="#">Forgot Password?</a>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-login">
                <button type="submit" class="btn btn-primary w-100" :disabled="submitting">
                  {{ submitting ? 'Signing in…' : 'Sign In' }}
                </button>
              </div>

              <div class="my-4 d-flex justify-content-center align-items-center copyright-text">
                <p>Copyright &copy; {{ new Date().getFullYear() }} uPOS</p>
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
}

/* Blurred background image, kept on its own layer so the card stays sharp */
.login-wrapper.login-centered::before {
  content: '';
  position: fixed;
  inset: 0;
  background: url('/assets/img/authentication/login-img.jpg') center / cover no-repeat;
  filter: blur(10px);
  transform: scale(1.1); /* hides the soft edges the blur creates */
  z-index: 0;
}

.login-wrapper.login-centered .login-content.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 460px;
  height: auto;
  padding: 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
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
