<script setup lang="ts">
// Money received this month, by payment method. One bar per method, longest first.
import { computed } from 'vue'
import type { PaymentMethodTotals } from '@/api/dashboard'
import { paymentMethodLabel } from '@/api/sales'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<PaymentMethodTotals>('payment-methods')

const total = computed(() => data.value?.items.reduce((sum, m) => sum + m.cents, 0) ?? 0)
const max = computed(() => Math.max(...(data.value?.items.map((m) => m.cents) ?? []), 1))

const percent = (cents: number) => (total.value ? Math.round((cents / total.value) * 100) : 0)
</script>

<template>
  <WidgetCard title="Payment Methods" icon="credit-card" :loading="loading" :error="error" @retry="load">
    <div class="d-flex align-items-baseline justify-content-between gap-2 mb-3">
      <span class="fs-13 text-gray-5">Received this month</span>
      <span class="fs-18 fw-bold text-gray-9">{{ formatMoney(total) }}</span>
    </div>
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-credit-card"></i>No payments yet this month.
    </div>
    <ul v-else class="list-unstyled mb-0">
      <li v-for="method in data?.items" :key="method.method" class="mb-3">
        <div class="d-flex justify-content-between gap-2 fs-13 mb-1">
          <span class="fw-medium text-gray-9">{{ paymentMethodLabel(method.method) }}</span>
          <span class="text-gray-7 text-nowrap">
            {{ formatMoney(method.cents) }} <span class="text-gray-5">· {{ percent(method.cents) }}%</span>
          </span>
        </div>
        <div
          class="track"
          role="img"
          :aria-label="`${paymentMethodLabel(method.method)}: ${percent(method.cents)}% of payments, ${method.count} payments`"
          :title="`${method.count} ${method.count === 1 ? 'payment' : 'payments'}`"
        >
          <div class="fill" :style="{ width: `${(method.cents / max) * 100}%` }"></div>
        </div>
      </li>
    </ul>
  </WidgetCard>
</template>

<style scoped>
.track {
  height: 8px;
  border-radius: 4px;
  background: #f2f4f6;
  overflow: hidden;
}

.fill {
  height: 100%;
  min-width: 4px;
  border-radius: 4px;
  background: #fe9f43;
  transition: width 0.3s ease;
}
</style>
