<script setup lang="ts">
// Edits a plan's name, price and limits.
import { ref } from 'vue'
import { updatePlan, type PanelPlan } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ plan: PanelPlan }>()
const emit = defineEmits<{ close: []; saved: [plan: PanelPlan] }>()

const name = ref(props.plan.name)
const monthlyPrice = ref<number | ''>(props.plan.monthlyPrice)
const maxUsers = ref<number | ''>(props.plan.maxUsers)
const maxAdmins = ref<number | ''>(props.plan.maxAdmins ?? '') // blank: any user may be an admin
const maxProducts = ref<number | ''>(props.plan.maxProducts)
const error = ref('')
const saving = ref(false)

const isWhole = (value: number | '', min: number): value is number => value !== '' && Number.isInteger(value) && value >= min

async function save() {
  error.value = ''
  if (!name.value.trim()) return void (error.value = 'Plan name is required.')
  if (!isWhole(monthlyPrice.value, 0)) return void (error.value = 'Monthly price must be a whole number of pesos.')
  if (!isWhole(maxUsers.value, 1)) return void (error.value = 'Users must be at least 1.')
  if (maxAdmins.value !== '' && !isWhole(maxAdmins.value, 1)) {
    return void (error.value = 'Admins must be at least 1, or left blank for any.')
  }
  if (!isWhole(maxProducts.value, 0)) return void (error.value = 'Products must be 0 or more.')

  saving.value = true
  try {
    const saved = await updatePlan(props.plan.id, {
      name: name.value,
      monthlyPrice: monthlyPrice.value,
      maxUsers: maxUsers.value,
      maxAdmins: maxAdmins.value === '' ? null : maxAdmins.value,
      maxProducts: maxProducts.value,
    })
    emit('saved', saved)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the plan'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="`Edit ${plan.name} Plan`" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div v-if="plan.stores" class="alert alert-light border py-2 fs-14">
          {{ plan.stores }} store{{ plan.stores === 1 ? ' is' : 's are' }} on this plan. New limits apply right away;
          stores already over a lower limit keep what they have but can't add more.
        </div>
        <div class="row g-3">
          <div class="col-sm-6">
            <label class="form-label" for="plan-name">Name <span class="text-danger">*</span></label>
            <input id="plan-name" v-model="name" type="text" maxlength="50" class="form-control" />
          </div>
          <div class="col-sm-6">
            <label class="form-label" for="plan-price">Monthly price (₱) <span class="text-danger">*</span></label>
            <input id="plan-price" v-model.number="monthlyPrice" type="number" min="0" step="1" class="form-control" />
          </div>
          <div class="col-sm-4">
            <label class="form-label" for="plan-users">Users <span class="text-danger">*</span></label>
            <input id="plan-users" v-model.number="maxUsers" type="number" min="1" step="1" class="form-control" />
          </div>
          <div class="col-sm-4">
            <label class="form-label" for="plan-admins">Admins</label>
            <input
              id="plan-admins"
              v-model.number="maxAdmins"
              type="number"
              min="1"
              step="1"
              class="form-control"
              placeholder="Any"
            />
          </div>
          <div class="col-sm-4">
            <label class="form-label" for="plan-products">Products <span class="text-danger">*</span></label>
            <input id="plan-products" v-model.number="maxProducts" type="number" min="0" step="1" class="form-control" />
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppModal>
</template>
