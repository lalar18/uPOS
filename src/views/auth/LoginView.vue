<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { googleSignInUrl, login } from '@/auth'

const router = useRouter()
const route = useRoute()

// Codes the Google sign-in sends back with ?error= (see worker/google.ts)
const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: "Signing in with Google isn't available right now.",
  google_failed: "Google sign-in didn't work. Please try again.",
  google_unverified: "Your Google account's email address isn't verified yet.",
  google_mismatch: 'This email is linked to a different Google account.',
  account_disabled: 'This account or its store has been disabled. Please contact your store admin.',
}

const email = ref('')
const password = ref('')
const rememberMe = ref(false)
const showPassword = ref(false)
const error = ref(GOOGLE_ERRORS[String(route.query.error)] ?? '')
const submitting = ref(false)

const redirectPath = () =>
  typeof route.query.redirect === 'string' && /^\/(?![/\\])/.test(route.query.redirect) ? route.query.redirect : '/'

function signInWithGoogle() {
  window.location.href = googleSignInUrl(rememberMe.value, redirectPath())
}

async function handleSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await login(email.value, password.value, rememberMe.value)
    router.replace(redirectPath())
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
              <RouterLink :to="{ name: 'landing' }" class="login-logo logo-normal" title="Back to home">
                <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
              </RouterLink>
              <a href="#" class="login-logo logo-white">
                <img src="/assets/img/logo-white.svg" alt="USystems POS" />
              </a>

              <div class="login-userheading">
                <h3>Sign In</h3>
                <h4 class="fs-16">Access the USystems POS panel using your email and password.</h4>
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

              <div class="login-or">
                <span>or</span>
              </div>

              <div class="form-login">
                <button type="button" class="btn btn-google w-100" @click="signInWithGoogle">
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  Continue with Google
                </button>
              </div>

              <p class="text-center fs-14 text-gray-6 mb-0">
                New to USystems POS? Continue with Google to create your store, free for 14 days.
              </p>

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

.login-or {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  color: #9ca3af;
}

.login-or::before,
.login-or::after {
  content: '';
  flex: 1;
  border-top: 1px solid #e5e7eb;
}

.btn-google {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #dadce0;
  color: #3c4043;
  font-weight: 500;
}

.btn-google:hover {
  background: #f8f9fa;
  border-color: #c6c9cc;
}

@media (max-width: 575.98px) {
  .login-wrapper.login-centered .login-content.login-card {
    padding: 24px 20px;
  }
}
</style>
