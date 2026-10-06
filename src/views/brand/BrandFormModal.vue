<script setup lang="ts">
// Add / edit dialog for a brand. Pass `brand` to edit, or null to add.
import { onBeforeUnmount, ref } from 'vue'
import { createBrand, removeBrandLogo, updateBrand, uploadBrandLogo, type Brand } from '@/api/brands'
import AppModal from '@/components/AppModal.vue'
import { resizeImage } from '@/utils/image'

const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB, checked on the original file
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const LOGO_SIZE = 256 // logos are scaled down to fit a 256x256 px box

const props = defineProps<{ brand: Brand | null }>()
const emit = defineEmits<{ close: []; saved: [brand: Brand, isNew: boolean] }>()

const name = ref(props.brand?.name ?? '')
const active = ref((props.brand?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)
// The saved brand. Set after a create, so a retry (e.g. the logo upload failed) updates instead of adding twice.
let target = props.brand

// --- Logo ---

const fileInput = ref<HTMLInputElement | null>(null)
const logoFile = ref<File | null>(null) // newly picked, uploaded on save
const logoPreview = ref<string | null>(props.brand?.logoUrl ?? null)
const logoRemoved = ref(false) // the existing logo should be deleted on save

function revokePreview() {
  if (logoPreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoPreview.value)
}
onBeforeUnmount(revokePreview)

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // lets the same file be picked again
  error.value = ''

  if (!file) return
  if (!ALLOWED_TYPES.includes(file.type)) {
    error.value = 'Please choose a JPG, PNG or WebP image.'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`
    return
  }

  revokePreview()
  logoFile.value = file
  logoPreview.value = URL.createObjectURL(file)
  logoRemoved.value = false
}

function removeLogo() {
  revokePreview()
  logoFile.value = null
  logoPreview.value = null
  logoRemoved.value = props.brand?.logoUrl != null
}

async function save() {
  error.value = ''
  const input = { name: name.value.trim(), status: active.value ? ('active' as const) : ('inactive' as const) }
  if (!input.name) {
    error.value = 'Brand name is required.'
    return
  }

  saving.value = true
  try {
    let saved = target ? await updateBrand(target.id, input) : await createBrand(input)
    target = saved
    if (logoFile.value) saved = await uploadBrandLogo(saved.id, await resizeImage(logoFile.value, LOGO_SIZE))
    else if (logoRemoved.value) saved = await removeBrandLogo(saved.id)
    emit('saved', saved, props.brand === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the brand'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="brand ? 'Edit Brand' : 'Add Brand'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <div class="d-flex align-items-center gap-3 mb-3">
          <div class="logo-box">
            <img v-if="logoPreview" :src="logoPreview" alt="Brand logo" />
            <i v-else class="ti ti-photo"></i>
          </div>
          <div>
            <div class="d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm btn-primary" @click="fileInput?.click()">
                <i class="ti ti-upload me-1"></i>{{ logoPreview ? 'Change Logo' : 'Upload Logo' }}
              </button>
              <button v-if="logoPreview" type="button" class="btn btn-sm btn-secondary" @click="removeLogo">
                Remove
              </button>
            </div>
            <div class="form-text">JPG, PNG or WebP, up to 2 MB.</div>
          </div>
          <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onFileChosen" />
        </div>

        <div class="mb-3">
          <label class="form-label" for="brand-name">Brand <span class="text-danger">*</span></label>
          <input id="brand-name" v-model="name" type="text" class="form-control" maxlength="100" required autofocus />
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="brand-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="brand-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="brand-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : brand ? 'Save Changes' : 'Add Brand' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.logo-box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border: 1px dashed #e6eaed;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 24px;
  overflow: hidden;
}

.logo-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
</style>
