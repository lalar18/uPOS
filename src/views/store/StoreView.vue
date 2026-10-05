<script setup lang="ts">
// Store information for the logged-in user's store. Admins can edit; cashiers see it read-only.
import { computed, ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { getStore, updateStore, type Store, type StoreInput } from '@/api/store'
import { currentUser } from '@/auth'

const isAdmin = computed(() => currentUser.value?.role === 'admin')

const store = ref<Store | null>(null)
const form = ref<StoreInput>(toInput(null))
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saveSuccess = ref('')
const saving = ref(false)

function toInput(s: Store | null): StoreInput {
  return {
    name: s?.name ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    address: s?.address ?? '',
    city: s?.city ?? '',
    province: s?.province ?? '',
    postalCode: s?.postalCode ?? '',
    tin: s?.tin ?? '',
  }
}

const isDirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(toInput(store.value)))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    store.value = await getStore()
    form.value = toInput(store.value)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the store'
  } finally {
    loading.value = false
  }
}
load()

async function save() {
  saveError.value = ''
  saveSuccess.value = ''
  if (!form.value.name.trim()) {
    saveError.value = 'Store name is required.'
    return
  }

  saving.value = true
  try {
    store.value = await updateStore(form.value)
    form.value = toInput(store.value)
    // The header shows the store name
    if (currentUser.value) currentUser.value.store = { id: store.value.id, name: store.value.name }
    saveSuccess.value = 'Store information saved.'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save the store'
  } finally {
    saving.value = false
  }
}

function reset() {
  form.value = toInput(store.value)
  saveError.value = ''
  saveSuccess.value = ''
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Store Information</h4>
      <h6>{{ isAdmin ? 'Manage your store details' : 'Your store details' }}</h6>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between" role="alert">
    {{ loadError }}
    <button type="button" class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
  </div>

  <div v-else class="card" :class="{ 'is-loading': loading }">
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0"><i class="ti ti-building-store me-2"></i>{{ store?.name ?? 'Store' }}</h5>
      <span v-if="store" class="fs-12 text-gray-5">Last updated {{ formatDate(store.updatedAt) }}</span>
    </div>
    <form @submit.prevent="save">
      <fieldset class="card-body" :disabled="!isAdmin || loading || saving">
        <div v-if="saveError" class="alert alert-danger py-2" role="alert">{{ saveError }}</div>
        <div v-if="saveSuccess" class="alert alert-success py-2" role="alert">{{ saveSuccess }}</div>

        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-name">Store Name <span class="text-danger">*</span></label>
            <input id="store-name" v-model="form.name" type="text" class="form-control" maxlength="100" required />
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-tin">TIN</label>
            <input
              id="store-tin"
              v-model="form.tin"
              type="text"
              class="form-control"
              maxlength="20"
              inputmode="numeric"
              pattern="[0-9\-]+"
              title="Numbers and dashes only"
              placeholder="000-000-000-00000"
            />
            <div class="form-text">Taxpayer Identification Number, shown on receipts.</div>
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-email">Email</label>
            <input id="store-email" v-model="form.email" type="email" class="form-control" maxlength="254" />
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-phone">Phone</label>
            <input
              id="store-phone"
              v-model="form.phone"
              type="tel"
              class="form-control"
              maxlength="30"
              pattern="[0-9+()\-\s]+"
              title="Numbers, spaces and + ( ) - only"
              placeholder="0917 123 4567"
            />
          </div>
          <div class="col-12 mb-3">
            <label class="form-label" for="store-address">Address</label>
            <input
              id="store-address"
              v-model="form.address"
              type="text"
              class="form-control"
              maxlength="255"
              placeholder="Unit / building, street, barangay"
            />
          </div>
          <div class="col-md-5 mb-3">
            <label class="form-label" for="store-city">City / Municipality</label>
            <input id="store-city" v-model="form.city" type="text" class="form-control" maxlength="100" />
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label" for="store-province">Province</label>
            <input id="store-province" v-model="form.province" type="text" class="form-control" maxlength="100" />
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label" for="store-postal-code">Postal Code</label>
            <input
              id="store-postal-code"
              v-model="form.postalCode"
              type="text"
              class="form-control"
              maxlength="10"
              inputmode="numeric"
            />
          </div>
        </div>

        <div v-if="isAdmin" class="d-flex justify-content-end gap-2">
          <button type="button" class="btn btn-secondary" :disabled="!isDirty" @click="reset">Discard Changes</button>
          <button type="submit" class="btn btn-primary" :disabled="!isDirty">
            {{ saving ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
        <p v-else class="fs-12 text-gray-5 mb-0">Only admins can change store information.</p>
      </fieldset>
    </form>
  </div>
</template>

<style scoped>
.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

fieldset {
  min-width: 0;
}
</style>
