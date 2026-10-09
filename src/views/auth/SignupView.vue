<script setup lang="ts">
// Last step of signing up with Google: a new Google account names its store. The API sends
// new Google accounts here (see worker/google.ts); everyone else never sees this page.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { completeGoogleSignup, getGoogleSignup, googleSignInUrl, type GoogleSignup } from '@/auth'

const router = useRouter()

const signup = ref<GoogleSignup | null>(null)
const loadError = ref('')
const storeName = ref('')
const phone = ref('')
const error = ref('')
const submitting = ref(false)

onMounted(async () => {
  try {
    signup.value = await getGoogleSignup()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Your sign-up could not be loaded'
  }
})

async function handleSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await completeGoogleSignup({ name: storeName.value, phone: phone.value })
    router.replace({ name: 'dashboard' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Your store could not be created'
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

              <div class="login-userheading">
                <h3>Create Your Store</h3>
                <h4 v-if="signup" class="fs-16">
                  Signed in with Google as <strong>{{ signup.email }}</strong>. Name your store to start your
                  {{ signup.trialDays }}-day free trial.
                </h4>
              </div>

              <template v-if="loadError">
                <div class="alert alert-warning py-2" role="alert">{{ loadError }}</div>
                <a :href="googleSignInUrl()" class="btn btn-primary w-100">Continue with Google</a>
              </template>

              <div v-else-if="!signup" class="text-center py-4 text-gray-6">Loading…</div>

              <template v-else>
                <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

                <div class="mb-3">
                  <label class="form-label">Your Name</label>
                  <input :value="signup.fullName" type="text" class="form-control" readonly />
                  <div class="form-text">You'll be the store's Admin. You can change this on your profile later.</div>
                </div>

                <div class="mb-3">
                  <label class="form-label">Store Name <span class="text-danger">*</span></label>
                  <input
                    v-model="storeName"
                    type="text"
                    class="form-control"
                    maxlength="100"
                    autocomplete="organization"
                    required
                    autofocus
                  />
                </div>

                <div class="mb-3">
                  <label class="form-label">Phone</label>
                  <input v-model="phone" type="tel" class="form-control" maxlength="30" autocomplete="tel" />
                  <div class="form-text">Optional. Add the address and TIN later on the Store page.</div>
                </div>

                <div class="form-login">
                  <button type="submit" class="btn btn-primary w-100" :disabled="submitting">
                    {{ submitting ? 'Creating your store…' : 'Create Store' }}
                  </button>
                </div>
              </template>

              <p class="text-center fs-14 mt-3 mb-0">
                Already have an account? <RouterLink :to="{ name: 'login' }">Sign in</RouterLink>
              </p>
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
  transform: scale(1.1);
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

@media (max-width: 575.98px) {
  .login-wrapper.login-centered .login-content.login-card {
    padding: 24px 20px;
  }
}
</style>
