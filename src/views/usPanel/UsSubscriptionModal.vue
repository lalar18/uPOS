<script setup lang="ts">
// Moves a store to another plan and/or sets its expiry date directly, without a payment
// (corrections, goodwill extensions, ending a store early). Payments go through Record Payment.
import { ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { describeSeats, formatPrice, type Plan } from '@/api/subscription'
import { setStoreSubscription, type StoreDetail } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { addDays, toIsoDate } from '@/utils/date'

const props = defineProps<{ store: StoreDetail; plans: Plan[] }>()
const emit = defineEmits<{ close: []; saved: [store: StoreDetail] }>()

const planId = ref(props.store.plan.id)
const expiresOn = ref(props.store.expiresAt ? toIsoDate(parseDbDate(props.store.expiresAt)) : toIsoDate())
const error = ref('')
const saving = ref(false)

const extend = (days: number) => (expiresOn.value = addDays(expiresOn.value || toIsoDate(), days))

async function save() {
  error.value = ''
  if (!expiresOn.value) return void (error.value = 'Choose the expiry date.')
  saving.value = true
  try {
    emit('saved', await setStoreSubscription(props.store.id, planId.value, expiresOn.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not change the subscription'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="Change Plan or Expiry" @close="emit('close')">
    <form novalidate @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <p class="fs-14 text-gray-5">
          This changes the subscription without recording a payment. To renew a paying store, use
          <strong>Record Payment</strong> instead.
        </p>
        <div class="mb-3">
          <label class="form-label" for="sub-plan">Plan</label>
          <select id="sub-plan" v-model="planId" class="form-select">
            <option v-for="plan in plans" :key="plan.id" :value="plan.id">
              {{ plan.name }} · {{ formatPrice(plan.monthlyPrice) }}/mo · {{ describeSeats(plan) }}
            </option>
          </select>
        </div>
        <div class="mb-2">
          <label class="form-label" for="sub-expires">Expires on (end of day)</label>
          <input id="sub-expires" v-model="expiresOn" type="date" class="form-control" />
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-white border" @click="extend(7)">+7 days</button>
          <button type="button" class="btn btn-sm btn-white border" @click="extend(30)">+30 days</button>
          <button type="button" class="btn btn-sm btn-white border" @click="expiresOn = toIsoDate()">Today</button>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppModal>
</template>
