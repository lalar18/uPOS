<script setup lang="ts">
// Add / edit dialog for a supplier. Pass `supplier` to edit, or null to add.
import { ref } from 'vue'
import { createSupplier, updateSupplier, type Supplier } from '@/api/suppliers'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ supplier: Supplier | null }>()
const emit = defineEmits<{ close: []; saved: [supplier: Supplier, isNew: boolean] }>()

const name = ref(props.supplier?.name ?? '')
const contactPerson = ref(props.supplier?.contactPerson ?? '')
const phone = ref(props.supplier?.phone ?? '')
const email = ref(props.supplier?.email ?? '')
const address = ref(props.supplier?.address ?? '')
const note = ref(props.supplier?.note ?? '')
const active = ref((props.supplier?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

async function save() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = 'Supplier name is required.'
    return
  }
  const input = {
    name: name.value,
    contactPerson: contactPerson.value,
    phone: phone.value,
    email: email.value,
    address: address.value,
    note: note.value,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  saving.value = true
  try {
    const saved = props.supplier ? await updateSupplier(props.supplier.id, input) : await createSupplier(input)
    emit('saved', saved, props.supplier === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the supplier'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="supplier ? 'Edit Supplier' : 'Add Supplier'" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6">
            <label class="form-label" for="supplier-name">Supplier Name <span class="text-danger">*</span></label>
            <input
              id="supplier-name"
              v-model="name"
              type="text"
              class="form-control"
              maxlength="100"
              placeholder="e.g. ABC Trading"
              autofocus
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="supplier-contact">Contact Person</label>
            <input id="supplier-contact" v-model="contactPerson" type="text" class="form-control" maxlength="100" />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="supplier-phone">Phone</label>
            <input id="supplier-phone" v-model="phone" type="tel" class="form-control" maxlength="30" inputmode="tel" />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="supplier-email">Email</label>
            <input id="supplier-email" v-model="email" type="email" class="form-control" maxlength="254" />
          </div>
          <div class="col-12">
            <label class="form-label" for="supplier-address">Address</label>
            <input id="supplier-address" v-model="address" type="text" class="form-control" maxlength="255" />
          </div>
          <div class="col-12">
            <label class="form-label" for="supplier-note">Note</label>
            <textarea
              id="supplier-note"
              v-model="note"
              class="form-control"
              rows="3"
              maxlength="500"
              placeholder="e.g. delivery days, payment terms"
            ></textarea>
          </div>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="supplier-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="supplier-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="supplier-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : supplier ? 'Save Changes' : 'Add Supplier' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
