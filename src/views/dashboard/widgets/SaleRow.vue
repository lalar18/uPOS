<script setup lang="ts">
// One sale in the Recent Sales and Receivables widgets.
import { computed } from 'vue'
import type { DashboardSale } from '@/api/dashboard'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { formatMoney } from '@/utils/money'

const props = defineProps<{ sale: DashboardSale; showDue?: boolean }>()

const reference = computed(() => `INV-${String(props.sale.id).padStart(5, '0')}`)
const overdue = computed(() => props.sale.dueCents > 0 && !!props.sale.dueDate && props.sale.dueDate < toIsoDate())

const status = computed(() => {
  if (overdue.value) return { label: 'Overdue', class: 'bg-danger' }
  if (props.sale.dueCents <= 0) return { label: 'Paid', class: 'bg-success' }
  if (props.sale.paidCents > 0) return { label: 'Partial', class: 'bg-warning' }
  return { label: 'Unpaid', class: 'bg-secondary' }
})
</script>

<template>
  <li>
    <div class="min-w-0">
      <RouterLink :to="{ name: 'sale-detail', params: { id: sale.id } }" class="fw-medium">{{ reference }}</RouterLink>
      <div class="fs-12 text-gray-5 text-truncate">
        {{ sale.customerName }} ·
        <template v-if="showDue && sale.dueDate">due {{ formatIsoDate(sale.dueDate) }}</template>
        <template v-else>{{ formatIsoDate(sale.saleDate) }}</template>
      </div>
    </div>
    <div class="text-end flex-shrink-0">
      <div class="fw-semibold text-gray-9 text-nowrap">{{ formatMoney(showDue ? sale.dueCents : sale.totalCents) }}</div>
      <span class="badge" :class="status.class">{{ status.label }}</span>
    </div>
  </li>
</template>
