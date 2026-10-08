<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { changePassword, currentUser, isAdmin, removeAvatar, uploadAvatar } from '@/auth'
import UserAvatar from '@/components/UserAvatar.vue'
import StoreSubscriptionCard from './StoreSubscriptionCard.vue'

// --- Avatar ---

const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB, checked on the original file
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const OUTPUT_SIZE = 400 // saved avatars are 400x400 px

const fileInput = ref<HTMLInputElement | null>(null)
const cropImage = ref<HTMLImageElement | null>(null)
const cropSrc = ref<string | null>(null) // object URL of the picked file; the crop dialog shows while set
const avatarError = ref('')
const avatarBusy = ref(false)
let cropper: Cropper | null = null

function pickFile() {
  avatarError.value = ''
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // lets the same file be picked again after cancelling
  avatarError.value = ''

  if (!file) return
  if (!ALLOWED_TYPES.includes(file.type)) {
    avatarError.value = 'Please choose a JPG, PNG or WebP image.'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    avatarError.value = `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`
    return
  }

  cropSrc.value = URL.createObjectURL(file)
}

// Called by the <img> once the picked file has loaded
function startCropper() {
  if (!cropImage.value) return
  cropper?.destroy()
  cropper = new Cropper(cropImage.value, {
    aspectRatio: 1,
    viewMode: 1, // keep the crop box inside the image
    dragMode: 'move',
    autoCropArea: 1,
    background: false,
    guides: false,
    toggleDragModeOnDblclick: false,
  })
}

const zoom = (ratio: number) => cropper?.zoom(ratio)
const rotate = (degrees: number) => cropper?.rotate(degrees)

function closeCrop() {
  cropper?.destroy()
  cropper = null
  if (cropSrc.value) URL.revokeObjectURL(cropSrc.value)
  cropSrc.value = null
}

async function saveCrop() {
  if (!cropper) return
  avatarBusy.value = true
  avatarError.value = ''
  try {
    const canvas = cropper.getCroppedCanvas({
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      fillColor: '#ffffff', // JPEG has no transparency
      imageSmoothingQuality: 'high',
    })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not process the image')
    await uploadAvatar(blob)
    closeCrop()
  } catch (e) {
    avatarError.value = e instanceof Error ? e.message : 'Upload failed'
  } finally {
    avatarBusy.value = false
  }
}

async function handleRemoveAvatar() {
  avatarBusy.value = true
  avatarError.value = ''
  try {
    await removeAvatar()
  } catch (e) {
    avatarError.value = e instanceof Error ? e.message : 'Could not remove the photo'
  } finally {
    avatarBusy.value = false
  }
}

onBeforeUnmount(closeCrop)

// --- Password ---

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const show = ref({ current: false, new: false, confirm: false })
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordBusy = ref(false)

async function handleChangePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''

  if (newPassword.value.length < 8) {
    passwordError.value = 'New password must be at least 8 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = "New passwords don't match."
    return
  }

  passwordBusy.value = true
  try {
    await changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = newPassword.value = confirmPassword.value = ''
    passwordSuccess.value = 'Password updated. Any other devices signed in to your account have been logged out.'
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Could not change the password'
  } finally {
    passwordBusy.value = false
  }
}
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Profile</h4>
      <h6>Manage your photo and password</h6>
    </div>
  </div>

  <div class="row">
    <!-- Profile picture -->
    <div class="col-xl-4 col-lg-5 d-flex">
      <div class="card flex-fill">
        <div class="card-header">
          <h5 class="card-title mb-0">Profile Picture</h5>
        </div>
        <div class="card-body text-center">
          <UserAvatar :user="currentUser" :size="120" radius="50%" class="mb-3" />
          <h5 class="mb-1">{{ currentUser?.fullName }}</h5>
          <p class="text-gray-5 mb-2">{{ currentUser?.email }}</p>
          <span class="badge bg-primary-transparent mb-3">{{ currentUser?.role.name }}</span>

          <div v-if="avatarError" class="alert alert-danger py-2 text-start" role="alert">{{ avatarError }}</div>

          <div class="d-flex justify-content-center flex-wrap gap-2">
            <button type="button" class="btn btn-primary" :disabled="avatarBusy" @click="pickFile">
              <i class="ti ti-upload me-1"></i>{{ currentUser?.avatarUrl ? 'Change Photo' : 'Upload Photo' }}
            </button>
            <button
              v-if="currentUser?.avatarUrl"
              type="button"
              class="btn btn-outline-danger"
              :disabled="avatarBusy"
              @click="handleRemoveAvatar"
            >
              <i class="ti ti-trash me-1"></i>Remove
            </button>
          </div>
          <p class="fs-12 text-gray-5 mt-2 mb-0">JPG, PNG or WebP. Max 2 MB.</p>
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="d-none"
            @change="onFileChosen"
          />
        </div>
      </div>
    </div>

    <!-- Change password -->
    <div class="col-xl-8 col-lg-7 d-flex">
      <div class="card flex-fill">
        <div class="card-header">
          <h5 class="card-title mb-0">Change Password</h5>
        </div>
        <div class="card-body">
          <form autocomplete="on" @submit.prevent="handleChangePassword">
            <!-- Lets password managers pair the new password with this account -->
            <input type="email" :value="currentUser?.email" autocomplete="username" class="d-none" readonly />

            <div v-if="passwordError" class="alert alert-danger py-2" role="alert">{{ passwordError }}</div>
            <div v-if="passwordSuccess" class="alert alert-success py-2" role="alert">{{ passwordSuccess }}</div>

            <div class="mb-3">
              <label class="form-label">Current Password <span class="text-danger">*</span></label>
              <div class="pass-group">
                <input
                  v-model="currentPassword"
                  :type="show.current ? 'text' : 'password'"
                  class="pass-input form-control"
                  autocomplete="current-password"
                  required
                />
                <span
                  class="ti toggle-password text-gray-9"
                  :class="show.current ? 'ti-eye' : 'ti-eye-off'"
                  @click="show.current = !show.current"
                ></span>
              </div>
            </div>

            <div class="row">
              <div class="col-md-6 mb-3">
                <label class="form-label">New Password <span class="text-danger">*</span></label>
                <div class="pass-group">
                  <input
                    v-model="newPassword"
                    :type="show.new ? 'text' : 'password'"
                    class="pass-input form-control"
                    autocomplete="new-password"
                    minlength="8"
                    maxlength="128"
                    required
                  />
                  <span
                    class="ti toggle-password text-gray-9"
                    :class="show.new ? 'ti-eye' : 'ti-eye-off'"
                    @click="show.new = !show.new"
                  ></span>
                </div>
                <div class="form-text">At least 8 characters.</div>
              </div>
              <div class="col-md-6 mb-3">
                <label class="form-label">Confirm New Password <span class="text-danger">*</span></label>
                <div class="pass-group">
                  <input
                    v-model="confirmPassword"
                    :type="show.confirm ? 'text' : 'password'"
                    class="pass-input form-control"
                    autocomplete="new-password"
                    required
                  />
                  <span
                    class="ti toggle-password text-gray-9"
                    :class="show.confirm ? 'ti-eye' : 'ti-eye-off'"
                    @click="show.confirm = !show.confirm"
                  ></span>
                </div>
              </div>
            </div>

            <div class="text-end">
              <button type="submit" class="btn btn-primary" :disabled="passwordBusy">
                {{ passwordBusy ? 'Saving…' : 'Update Password' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>

  <StoreSubscriptionCard v-if="isAdmin()" />

  <!-- Crop dialog -->
  <template v-if="cropSrc">
    <div class="modal fade show d-block" tabindex="-1" role="dialog" aria-modal="true" @keydown.esc="closeCrop">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">Crop Photo</h4>
          </div>
          <div class="modal-body">
            <div class="crop-area">
              <img ref="cropImage" :src="cropSrc" alt="" @load="startCropper" />
            </div>
            <div class="d-flex justify-content-center gap-2 mt-3">
              <button type="button" class="btn btn-light btn-sm" title="Zoom in" @click="zoom(0.1)">
                <i class="ti ti-zoom-in"></i>
              </button>
              <button type="button" class="btn btn-light btn-sm" title="Zoom out" @click="zoom(-0.1)">
                <i class="ti ti-zoom-out"></i>
              </button>
              <button type="button" class="btn btn-light btn-sm" title="Rotate" @click="rotate(90)">
                <i class="ti ti-rotate-clockwise"></i>
              </button>
            </div>
            <p class="fs-12 text-gray-5 text-center mt-2 mb-0">Drag to move, scroll to zoom.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" :disabled="avatarBusy" @click="closeCrop">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="avatarBusy" @click="saveCrop">
              {{ avatarBusy ? 'Saving…' : 'Save Photo' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop fade show"></div>
  </template>
</template>

<style scoped>
.crop-area {
  height: 340px;
  background: #f7f7f7;
  border-radius: 8px;
  overflow: hidden;
}

/* Cropper needs the image to be block-level and constrained */
.crop-area img {
  display: block;
  max-width: 100%;
}

/* Show the crop as a circle, matching how the avatar is displayed */
.crop-area :deep(.cropper-view-box),
.crop-area :deep(.cropper-face) {
  border-radius: 50%;
}

.crop-area :deep(.cropper-view-box) {
  outline: 2px solid #fe9f43;
}
</style>
