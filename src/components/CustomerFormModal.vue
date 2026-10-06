<script setup lang="ts">
// "Add customer" dialog. `initialName` prefills the name (e.g. what was typed in a search).
import { ref } from 'vue'
import { createCustomer, type Customer } from '@/api/customers'
import AppModal from './AppModal.vue'

const props = defineProps<{ initialName?: string }>()
const emit = defineEmits<{ close: []; saved: [customer: Customer] }>()

const name = ref(props.initialName?.trim() ?? '')
const phone = ref('')
const email = ref('')
const address = ref('')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = 'Customer name is required.'
    return
  }
  saving.value = true
  try {
    emit(
      'saved',
      await createCustomer({ name: name.value, phone: phone.value, email: email.value, address: address.value }),
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add the customer'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Add Customer" @close="emit('close')">
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
        <div>
          <label class="form-label" for="customer-address">Address</label>
          <input id="customer-address" v-model="address" type="text" class="form-control" maxlength="255" />
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Add Customer' }}</button>
      </div>
    </form>
  </AppModal>
</template>
