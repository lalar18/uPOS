<script setup lang="ts">
// This month's gross profit: net sales (before tax) less the cost of what was sold.
import { computed } from 'vue'
import type { ProfitSummary } from '@/api/dashboard'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<ProfitSummary>('profit')

const margin = computed(() => {
  const d = data.value
  if (!d || d.netSalesCents <= 0) return null
  return Math.round((d.profitCents / d.netSalesCents) * 1000) / 10
})
</script>

<template>
  <WidgetCard title="Profit This Month" icon="report-money" :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <div class="mb-3">
        <div class="fs-13 text-gray-5">Gross profit</div>
        <div class="d-flex align-items-baseline flex-wrap gap-2">
          <span class="fs-24 fw-bold" :class="data.profitCents < 0 ? 'text-danger' : 'text-gray-9'">
            {{ formatMoney(data.profitCents) }}
          </span>
          <span v-if="margin !== null" class="badge" :class="margin < 0 ? 'bg-danger' : 'bg-success'">
            {{ margin }}% margin
          </span>
        </div>
      </div>
      <dl class="rows mb-0">
        <div>
          <dt>Net sales <span class="text-gray-5 fw-normal">(before tax)</span></dt>
          <dd>{{ formatMoney(data.netSalesCents) }}</dd>
        </div>
        <div>
          <dt>Cost of goods sold</dt>
          <dd>−{{ formatMoney(data.costCents) }}</dd>
        </div>
      </dl>
      <div v-if="data.missingCost" class="fs-12 text-warning mt-3">
        <i class="ti ti-alert-triangle me-1"></i>{{ data.missingCost }}
        {{ data.missingCost === 1 ? 'item was' : 'items were' }} sold without a cost price, so profit may be too high.
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
