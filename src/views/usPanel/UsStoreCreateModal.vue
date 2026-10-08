<script setup lang="ts">
// Adds a store on a plan with its first admin, who can then sign in at /login and add
// the rest of the store's users.
import { reactive, ref, watch } from 'vue'
import { formatPrice, type Plan } from '@/api/subscription'
import { createStore, type StoreDetail } from '@/api/usPanel'
import { MIN_PASSWORD_LENGTH } from '@/api/users'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ plans: Plan[] }>()
const emit = defineEmits<{ close: []; saved: [store: StoreDetail] }>()

const form = reactive({
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  province: '',
  postalCode: '',
  tin: '',
  planId: props.plans[0]?.id ?? '',
  trialDays: 30,
  admin: { fullName: '', email: '', password: '' },
})
const showPassword = ref(false)
const error = ref('')
const saving = ref(false)

// The plans may still be loading when the form opens
watch(
  () => props.plans,
  (plans) => {
    if (!form.planId) form.planId = plans[0]?.id ?? ''
  },
)

async function save() {
  error.value = ''
  if (!form.name.trim()) return void (error.value = 'Store name is required.')
  if (!form.planId) return void (error.value = 'Choose a plan.')
  if (!form.admin.fullName.trim() || !form.admin.email.trim()) {
    return void (error.value = "Enter the admin's name and email.")
  }
  if (form.admin.password.length < MIN_PASSWORD_LENGTH) {
    return void (error.value = `The admin's password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  saving.value = true
  try {
    emit('saved', await createStore({ ...form, admin: { ...form.admin } }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add the store'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Add Store" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>

        <h6 class="mb-3">Store</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <label class="form-label" for="new-store-name">Store name <span class="text-danger">*</span></label>
            <input id="new-store-name" v-model="form.name" type="text" maxlength="100" class="form-control" autofocus />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-store-email">Store email</label>
            <input id="new-store-email" v-model="form.email" type="email" maxlength="254" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-store-phone">Phone</label>
            <input id="new-store-phone" v-model="form.phone" type="tel" maxlength="30" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-store-city">City</label>
            <input id="new-store-city" v-model="form.city" type="text" maxlength="100" class="form-control" />
          </div>
        </div>

        <h6 class="mb-3">Subscription</h6>
        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <label class="form-label" for="new-store-plan">Plan <span class="text-danger">*</span></label>
            <select id="new-store-plan" v-model="form.planId" class="form-select">
              <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                {{ plan.name }} · {{ formatPrice(plan.monthlyPrice) }}/mo
              </option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-store-trial">Free days before first payment</label>
            <input
              id="new-store-trial"
              v-model.number="form.trialDays"
              type="number"
              min="0"
              max="365"
              step="1"
              class="form-control"
            />
            <div class="form-text">0 makes it view-only until a payment is recorded.</div>
          </div>
        </div>

        <h6 class="mb-3">Store admin (first user)</h6>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label" for="new-admin-name">Full name <span class="text-danger">*</span></label>
            <input id="new-admin-name" v-model="form.admin.fullName" type="text" maxlength="100" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-admin-email">Login email <span class="text-danger">*</span></label>
            <input
              id="new-admin-email"
              v-model="form.admin.email"
              type="email"
              maxlength="254"
              class="form-control"
              autocomplete="off"
            />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="new-admin-password">Password <span class="text-danger">*</span></label>
            <input
              id="new-admin-password"
              v-model="form.admin.password"
              :type="showPassword ? 'text' : 'password'"
              maxlength="128"
              class="form-control"
              autocomplete="new-password"
            />
          </div>
          <div class="col-md-6 d-flex align-items-end">
            <div class="form-check mb-2">
              <input id="new-admin-show" v-model="showPassword" class="form-check-input" type="checkbox" />
              <label class="form-check-label" for="new-admin-show">
                Show password · at least {{ MIN_PASSWORD_LENGTH }} characters
              </label>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Adding…' : 'Add Store' }}</button>
      </div>
    </form>
  </AppModal>
</template>
