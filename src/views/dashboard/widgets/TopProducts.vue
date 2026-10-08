<script setup lang="ts">
// Best sellers this month by net sales (after returns).
import type { TopProducts } from '@/api/dashboard'
import { formatQuantity } from '@/api/products'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<TopProducts>('top-products')
</script>

<template>
  <WidgetCard
    title="Top Products This Month"
    icon="trophy"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/products' }"
    @retry="load"
  >
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-trophy"></i>No sales yet this month.
    </div>
    <ol v-else class="widget-list">
      <li v-for="(product, i) in data?.items" :key="`${product.productId}-${product.sku}`">
        <div class="d-flex align-items-center gap-2 min-w-0">
          <span class="rank" :class="{ first: i === 0 }">{{ i + 1 }}</span>
          <div class="min-w-0">
            <div class="fw-medium text-gray-9 text-truncate">{{ product.name }}</div>
            <div class="fs-12 text-gray-5 text-truncate">
              {{ product.sku }} · {{ formatQuantity(product.quantity) }} {{ product.unitShortName }} sold
            </div>
          </div>
        </div>
        <span class="fw-semibold text-gray-9 text-nowrap">{{ formatMoney(product.cents) }}</span>
      </li>
    </ol>
  </WidgetCard>
</template>

<style scoped>
.rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #f2f4f6;
  color: #646b72;
  font-size: 12px;
  font-weight: 600;
}

.rank.first {
  background: rgba(254, 159, 67, 0.15);
  color: #e0801f;
}
</style>
