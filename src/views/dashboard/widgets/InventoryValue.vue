<script setup lang="ts">
// What the stock on hand is worth, at cost and at selling price (active products only).
import type { InventoryValue } from '@/api/dashboard'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<InventoryValue>('inventory-value')
</script>

<template>
  <WidgetCard
    title="Inventory Value"
    icon="building-warehouse"
    :loading="loading"
    :error="error"
    :link="{ to: '/stock', label: 'Stock' }"
    @retry="load"
  >
    <template v-if="data">
      <div class="mb-3">
        <div class="fs-13 text-gray-5">Stock at cost</div>
        <div class="fs-24 fw-bold text-gray-9">{{ formatMoney(data.costCents) }}</div>
      </div>
      <dl class="rows mb-0">
        <div>
          <dt>At selling price</dt>
          <dd>{{ formatMoney(data.retailCents) }}</dd>
        </div>
        <div>
          <dt>Potential profit</dt>
          <dd>{{ formatMoney(data.retailCents - data.costCents) }}</dd>
        </div>
        <div>
          <dt>Active products</dt>
          <dd>{{ data.products.toLocaleString() }}</dd>
        </div>
      </dl>
      <div v-if="data.missingCost" class="fs-12 text-warning mt-3">
        <i class="ti ti-alert-triangle me-1"></i>{{ data.missingCost }}
        {{ data.missingCost === 1 ? 'product in stock has' : 'products in stock have' }} no cost price.
      </div>
    </template>
  </WidgetCard>
</template>

<style scoped>
.rows > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #e6eaed;
  font-size: 14px;
}

.rows dt {
  font-weight: 500;
  color: #212b36;
}

.rows dd {
  margin: 0;
  white-space: nowrap;
  color: #212b36;
}
</style>
