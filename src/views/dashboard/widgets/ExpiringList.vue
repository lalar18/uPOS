<script setup lang="ts">
// Products that have expired or expire soon, soonest first.
import type { ExpiringProducts } from '@/api/dashboard'
import { formatQuantity } from '@/api/products'
import { can } from '@/auth'
import { daysBetween, formatIsoDate, toIsoDate } from '@/utils/date'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<ExpiringProducts>('expiring')

function whenText(expiryDate: string): string {
  const days = daysBetween(toIsoDate(), expiryDate)
  if (days < 0) return `Expired ${-days}d ago`
  if (days === 0) return 'Expires today'
  return `In ${days}d`
}
</script>

<template>
  <WidgetCard
    title="Expiring Products"
    icon="calendar-exclamation"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/products/expired' }"
    @retry="load"
  >
    <div v-if="data && data.items.length > 0" class="d-flex flex-wrap gap-3 px-3 pt-3 pb-2">
      <div>
        <div class="fs-12 text-gray-5">Expired</div>
        <div class="fw-bold" :class="data.expired ? 'text-danger' : 'text-gray-9'">{{ data.expired }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Within {{ data.soonDays }} days</div>
        <div class="fw-bold text-gray-9">{{ data.soon }}</div>
      </div>
    </div>
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-calendar-check"></i>Nothing expires in the next {{ data.soonDays }} days.
    </div>
    <ul v-else class="widget-list">
      <li v-for="product in data?.items" :key="product.id">
        <div class="min-w-0">
          <RouterLink
            v-if="can('products.manage')"
            :to="{ name: 'product-edit', params: { id: product.id } }"
            class="fw-medium d-block text-truncate"
          >
            {{ product.name }}
          </RouterLink>
          <div v-else class="fw-medium text-gray-9 text-truncate">{{ product.name }}</div>
          <div class="fs-12 text-gray-5 text-truncate">
            {{ formatIsoDate(product.expiryDate!) }} · {{ formatQuantity(product.quantity) }} {{ product.unitShortName }} in stock
          </div>
        </div>
        <span
          class="badge flex-shrink-0"
          :class="product.expiryDate! < toIsoDate() ? 'bg-danger' : 'bg-warning'"
        >
          {{ whenText(product.expiryDate!) }}
        </span>
      </li>
    </ul>
  </WidgetCard>
</template>
