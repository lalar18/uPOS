<script setup lang="ts">
// Customers who bought the most this month (walk-in sales aren't counted).
import type { TopCustomers } from '@/api/dashboard'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<TopCustomers>('top-customers')

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
</script>

<template>
  <WidgetCard
    title="Top Customers This Month"
    icon="users-group"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/customers' }"
    @retry="load"
  >
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-users-group"></i>No sales to named customers yet this month.
    </div>
    <ul v-else class="widget-list">
      <li v-for="customer in data?.items" :key="customer.id">
        <div class="d-flex align-items-center gap-2 min-w-0">
          <span class="avatar-initials">{{ initials(customer.name) }}</span>
          <div class="min-w-0">
            <div class="fw-medium text-gray-9 text-truncate">{{ customer.name }}</div>
            <div class="fs-12 text-gray-5">{{ customer.count }} {{ customer.count === 1 ? 'sale' : 'sales' }}</div>
          </div>
        </div>
        <span class="fw-semibold text-gray-9 text-nowrap">{{ formatMoney(customer.cents) }}</span>
      </li>
    </ul>
  </WidgetCard>
</template>

<style scoped>
.avatar-initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f2f4f6;
  color: #212b36;
  font-size: 12px;
  font-weight: 600;
}
</style>
