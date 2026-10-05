<script setup lang="ts">
import { ref } from 'vue'

const showPassword = ref(false)
</script>

<template>
  <div class="main-wrapper">
    <div class="account-content">
      <div class="login-wrapper login-centered">
        <div class="login-content login-card">
          <form @submit.prevent>
            <div class="login-userset">
              <div class="login-logo logo-normal">
                <img src="/assets/img/logo.svg" alt="TindaPH" />
              </div>
              <a href="#" class="login-logo logo-white">
                <img src="/assets/img/logo-white.svg" alt="TindaPH" />
              </a>

              <div class="login-userheading">
                <h3>Sign In</h3>
                <h4 class="fs-16">Access the TindaPH panel using your email and password.</h4>
              </div>

              <div class="mb-3">
                <label class="form-label">Email <span class="text-danger">*</span></label>
                <div class="input-group">
                  <input type="email" class="form-control border-end-0" autocomplete="email" />
                  <span class="input-group-text border-start-0">
                    <i class="ti ti-mail"></i>
                  </span>
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label">Password <span class="text-danger">*</span></label>
                <div class="pass-group">
                  <input
                    :type="showPassword ? 'text' : 'password'"
                    class="pass-input form-control"
                    autocomplete="current-password"
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
                        <input type="checkbox" class="form-control" />
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
                <button type="submit" class="btn btn-primary w-100">Sign In</button>
              </div>

              <div class="my-4 d-flex justify-content-center align-items-center copyright-text">
                <p>Copyright &copy; {{ new Date().getFullYear() }} TindaPH</p>
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
