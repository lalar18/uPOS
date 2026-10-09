<script setup lang="ts">
// Shows what a renewal will cost (plan price + online payment fee) before going to PayMongo.
import { formatPrice, type Plan } from '@/api/subscription'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ plan: Plan; fee: number; saving: boolean }>()
const emit = defineEmits<{ close: []; confirm: [] }>()

const total = () => props.plan.monthlyPrice + props.fee
</script>

<template>
  <AppModal title="Confirm Payment" size="sm" @close="emit('close')">
    <div class="modal-body">
      <div class="d-flex justify-content-between mb-2">
        <span>{{ plan.name }} plan, 1 month</span>
        <span>{{ formatPrice(plan.monthlyPrice) }}</span>
      </div>
      <div v-if="fee > 0" class="d-flex justify-content-between mb-2">
        <span>Online payment fee</span>
        <span>{{ formatPrice(fee) }}</span>
      </div>
      <div class="d-flex justify-content-between border-top pt-2 fw-bold">
        <span>Total</span>
        <span>{{ formatPrice(total()) }}</span>
      </div>
      <p class="fs-13 text-gray-5 mt-3 mb-0">You'll pay on PayMongo's secure checkout page.</p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
      <button type="button" class="btn btn-primary" :disabled="saving" @click="emit('confirm')">
        {{ saving ? 'Opening…' : `Pay ${formatPrice(total())}` }}
      </button>
    </div>
  </AppModal>
</template>
