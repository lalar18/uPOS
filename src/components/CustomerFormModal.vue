<script setup lang="ts">
// Add / edit dialog for a customer. Pass `customer` to edit; leave it out to add.
// `initialName` prefills the name when adding (e.g. what was typed in a search).
import { ref } from 'vue'
import { createCustomer, updateCustomer, type Customer } from '@/api/customers'
import AppModal from './AppModal.vue'

const props = defineProps<{ customer?: Customer | null; initialName?: string }>()
const emit = defineEmits<{ close: []; saved: [customer: Customer, isNew: boolean] }>()

const name = ref(props.customer?.name ?? props.initialName?.trim() ?? '')
const phone = ref(props.customer?.phone ?? '')
const email = ref(props.customer?.email ?? '')
const address = ref(props.customer?.address ?? '')
const active = ref((props.customer?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = 'Customer name is required.'
    return
  }
  const input = {
    name: name.value,
    phone: phone.value,
    email: email.value,
    address: address.value,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  saving.value = true
  try {
    const saved = props.customer ? await updateCustomer(props.customer.id, input) : await createCustomer(input)
    emit('saved', saved, !props.customer)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the customer'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="customer ? 'Edit Customer' : 'Add Customer'" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="customer-name">Name <span class="text-danger">*</span></label>
          <input id="customer-name" v-model="name" type="text" class="form-control" maxlength="100" autofocus />
        </div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6">
            <label class="form-label" for="customer-phone">Phone</label>
            <input id="customer-phone" v-model="phone" type="tel" class="form-control" maxlength="30" inputmode="tel" />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="customer-email">Email</label>
            <input id="customer-email" v-model="email" type="email" class="form-control" maxlength="254" />
          </div>
        </div>
        <div :class="{ 'mb-3': customer }">
          <label class="form-label" for="customer-address">Address</label>
          <input id="customer-address" v-model="address" type="text" class="form-control" maxlength="255" />
        </div>
        <div v-if="customer" class="d-flex align-items-start justify-content-between gap-3">
          <div>
            <label class="form-label mb-0" for="customer-status">Status</label>
            <div class="form-text mt-0">Inactive customers can't be picked on new sales.</div>
          </div>
          <div class="form-check form-switch mb-0 flex-shrink-0">
            <input id="customer-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="customer-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : customer ? 'Save Changes' : 'Add Customer' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
