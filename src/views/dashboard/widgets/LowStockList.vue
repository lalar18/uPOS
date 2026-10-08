<script setup lang="ts">
// Active products at or below their low stock alert, out of stock first.
import type { LowStock } from '@/api/dashboard'
import { formatQuantity } from '@/api/products'
import { can } from '@/auth'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<LowStock>('low-stock')
</script>

<template>
  <WidgetCard
    title="Low Stock"
    icon="alert-triangle"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/products/low-stocks' }"
    @retry="load"
  >
    <div v-if="data && data.items.length > 0" class="d-flex flex-wrap gap-3 px-3 pt-3 pb-2">
      <div>
        <div class="fs-12 text-gray-5">Out of stock</div>
        <div class="fw-bold" :class="data.out ? 'text-danger' : 'text-gray-9'">{{ data.out }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Running low</div>
        <div class="fw-bold text-gray-9">{{ data.low }}</div>
      </div>
    </div>
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-circle-check"></i>Every product is well stocked.
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
            {{ product.sku }} · alert at {{ formatQuantity(product.alertQuantity) }} {{ product.unitShortName }}
          </div>
        </div>
        <span class="badge flex-shrink-0" :class="product.quantity <= 0 ? 'bg-danger' : 'bg-warning'">
          {{ product.quantity <= 0 ? 'Out of stock' : `${formatQuantity(product.quantity)} ${product.unitShortName} left` }}
        </span>
      </li>
    </ul>
  </WidgetCard>
</template>
