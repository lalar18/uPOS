<script setup lang="ts">
// Where PayMongo sends a customer after paying a sale online (/payment-complete?status=).
// Public: the customer is usually on their own phone, not signed in. The store's screen
// shows the payment once PayMongo confirms it.
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const success = computed(() => route.query.status === 'success')
</script>

<template>
  <div class="payment-complete">
    <div class="card mb-0">
      <div class="card-body text-center p-4">
        <i class="ti fs-1 d-block mb-2" :class="success ? 'ti-circle-check text-success' : 'ti-circle-x text-danger'"></i>
        <h4 class="mb-2">{{ success ? 'Payment sent' : 'Payment not completed' }}</h4>
        <p class="mb-0 text-gray-5">
          <template v-if="success">Thank you! The store will see your payment in a moment. You can close this page.</template>
          <template v-else>Nothing was charged. Let the cashier know if you'd like to try again.</template>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.payment-complete {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 16px;
  background: #f7f7f7;
}

.payment-complete .card {
  width: 100%;
  max-width: 420px;
}
</style>
