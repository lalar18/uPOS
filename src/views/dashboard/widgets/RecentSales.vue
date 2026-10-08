<script setup lang="ts">
// The latest sales, newest first.
import type { RecentSales } from '@/api/dashboard'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'
import SaleRow from './SaleRow.vue'

const { data, loading, error, load } = useWidget<RecentSales>('recent-sales')
</script>

<template>
  <WidgetCard
    title="Recent Sales"
    icon="receipt-2"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/sales' }"
    @retry="load"
  >
    <div v-if="data && data.items.length === 0" class="widget-empty">
      <i class="ti ti-receipt-2"></i>No sales yet.
    </div>
    <ul v-else class="widget-list">
      <SaleRow v-for="sale in data?.items" :key="sale.id" :sale="sale" />
    </ul>
  </WidgetCard>
</template>
