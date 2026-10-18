<script setup lang="ts">
// Sets up the store's own GCash account on the General Settings page: the admin uploads the QR code
// GCash generated for their account. The POS only offers GCash once this is saved; the customer
// scans the QR, pays straight into this account, and the cashier types in the reference no.
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  formatGcashNumber,
  getGcashAccount,
  prepareQrImage,
  removeGcashAccount,
  saveGcashAccount,
  type GcashAccount,
} from '@/api/gcash'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'

const account = ref<GcashAccount | null>(null)
const accountName = ref('')
const accountNumber = ref('')
const qr = ref<Blob | null>(null) // a new QR picked, not saved yet
const qrPreview = ref('') // object URL of `qr`
const fileInput = ref<HTMLInputElement | null>(null)
const loading = ref(true)
const saving = ref(false)
const confirmingRemove = ref(false)
const error = ref('')
const success = ref('')

const shownQr = computed(() => qrPreview.value || account.value?.qrUrl || '')
const isDirty = computed(
  () =>
    !!qr.value ||
    accountName.value.trim() !== (account.value?.accountName ?? '') ||
    accountNumber.value.replace(/[\s-]/g, '') !== (account.value?.accountNumber ?? ''),
)

function fill(a: GcashAccount | null) {
  account.value = a
  accountName.value = a?.accountName ?? ''
  accountNumber.value = a ? formatGcashNumber(a.accountNumber) : ''
  setQr(null)
}

function setQr(blob: Blob | null) {
  if (qrPreview.value) URL.revokeObjectURL(qrPreview.value)
  qr.value = blob
  qrPreview.value = blob ? URL.createObjectURL(blob) : ''
}
onBeforeUnmount(() => setQr(null))

async function load() {
  loading.value = true
  error.value = ''
  try {
    fill(await getGcashAccount())
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the GCash account'
  } finally {
    loading.value = false
  }
}
load()

async function pickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // picking the same file again still fires change
  if (!file) return
  error.value = ''
  success.value = ''
  if (!file.type.startsWith('image/')) {
    error.value = 'Choose an image of your GCash QR code.'
    return
  }
  try {
    setQr(await prepareQrImage(file))
  } catch {
    error.value = 'Could not read that image. Try a PNG or JPG screenshot of your QR code.'
  }
}

async function save() {
  error.value = ''
  success.value = ''
  if (!accountName.value.trim()) {
    error.value = 'Enter the GCash account name.'
    return
  }
  const number = accountNumber.value.replace(/[\s-]/g, '')
  if (number && !/^(09\d{9}|\+639\d{9})$/.test(number)) {
    error.value = 'Enter the GCash number like 0917 123 4567, or leave it blank.'
    return
  }
  if (!account.value && !qr.value) {
    error.value = 'Upload your GCash QR code.'
    return
  }
  saving.value = true
  try {
    fill(await saveGcashAccount({ accountName: accountName.value.trim(), accountNumber: number, qr: qr.value }))
    success.value = 'GCash account saved. The POS now offers GCash.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the GCash account'
  } finally {
    saving.value = false
  }
}

/** After the account is removed (past GCash payments are kept) */
function removed() {
  confirmingRemove.value = false
  fill(null)
  success.value = 'GCash account removed. The POS no longer offers GCash.'
}
</script>

<template>
  <form class="card" :class="{ 'is-loading': loading }" novalidate @submit.prevent="save">
    <fieldset class="card-body" :disabled="loading || saving">
      <h5 class="section-title d-flex align-items-center">
        <img src="/assets/img/payments/gcash.svg" alt="" class="gcash-logo me-2" />GCash Payments
        <span class="badge ms-auto" :class="account ? 'bg-success' : 'bg-secondary'">
          {{ account ? 'Set up' : 'Not set up' }}
        </span>
      </h5>
      <p class="fs-13 text-gray-5 mb-3">
        Upload the QR code from your GCash app (GCash &gt; QR &gt; Receive / Generate QR). At the POS, the customer
        scans it and pays straight to your GCash account, then you type in the reference no. from their receipt.
        No service charge is added.
      </p>

      <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
      <div v-if="success" class="alert alert-success py-2" role="status">{{ success }}</div>

      <div class="row g-3">
        <div class="col-sm-auto">
          <div class="qr-box" :class="{ empty: !shownQr }">
            <img v-if="shownQr" :src="shownQr" alt="Your GCash QR code" />
            <div v-else class="text-gray-5 fs-13 text-center">
              <i class="ti ti-qrcode d-block mb-1"></i>No QR yet
            </div>
          </div>
          <input ref="fileInput" type="file" accept="image/*" class="d-none" @change="pickFile" />
          <button type="button" class="btn btn-sm btn-white border w-100 mt-2" @click="fileInput?.click()">
            <i class="ti ti-upload me-1"></i>{{ shownQr ? 'Change QR' : 'Upload QR' }}
          </button>
        </div>
        <div class="col-sm">
          <div class="mb-3">
            <label class="form-label" for="gcash-name">Account Name <span class="text-danger">*</span></label>
            <input
              id="gcash-name"
              v-model="accountName"
              type="text"
              class="form-control"
              maxlength="100"
              placeholder="e.g. Juan D."
            />
            <div class="form-text">Shown to the customer so they can check they're paying the right account.</div>
          </div>
          <div class="mb-3">
            <label class="form-label" for="gcash-number">GCash Number</label>
            <input
              id="gcash-number"
              v-model="accountNumber"
              type="tel"
              class="form-control"
              maxlength="16"
              placeholder="0917 123 4567"
            />
            <div class="form-text">Optional. Shown under the QR for customers who send by number instead.</div>
          </div>
        </div>
      </div>

      <div class="form-actions d-flex flex-wrap justify-content-end gap-2">
        <button
          v-if="account"
          type="button"
          class="btn btn-outline-danger me-auto"
          @click="confirmingRemove = true"
        >
          Remove
        </button>
        <button type="button" class="btn btn-secondary" :disabled="!isDirty" @click="fill(account)">Discard</button>
        <button type="submit" class="btn btn-primary" :disabled="!isDirty">
          {{ saving ? 'Saving…' : account ? 'Save Changes' : 'Set Up GCash' }}
        </button>
      </div>
    </fieldset>
  </form>

  <ConfirmDeleteModal
    v-if="confirmingRemove"
    title="Remove GCash account"
    item-name="your GCash account"
    :action="removeGcashAccount"
    @close="confirmingRemove = false"
    @deleted="removed"
  />
</template>

<style scoped>
.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

fieldset {
  min-width: 0;
}

.section-title {
  font-size: 15px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e6eaed;
}

.gcash-logo {
  height: 18px;
}

.qr-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 180px;
  margin: 0 auto;
  padding: 6px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
}

.qr-box.empty {
  border-style: dashed;
}

.qr-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.qr-box i {
  font-size: 32px;
}

@media (max-width: 575.98px) {
  .form-actions .btn {
    flex: 1;
  }
}
</style>
