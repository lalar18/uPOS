<script setup lang="ts">
// Sales with a balance still owed: overdue first, then those due soonest.
import type { Receivables } from '@/api/dashboard'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'
import SaleRow from './SaleRow.vue'

const { data, loading, error, load } = useWidget<Receivables>('receivables')
</script>

<template>
  <WidgetCard
    title="Unpaid Invoices"
    icon="file-invoice"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/invoices' }"
    @retry="load"
  >
    <div v-if="data && data.count > 0" class="d-flex flex-wrap gap-3 px-3 pt-3 pb-2">
      <div>
        <div class="fs-12 text-gray-5">Total owed</div>
        <div class="fw-bold text-gray-9">{{ formatMoney(data.cents) }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Invoices</div>
        <div class="fw-bold text-gray-9">{{ data.count }}</div>
      </div>
      <div v-if="data.overdue">
        <div class="fs-12 text-gray-5">Overdue</div>
        <div class="fw-bold text-danger"><i class="ti ti-alert-triangle me-1"></i>{{ data.overdue }}</div>
      </div>
    </div>
    <div v-if="data && data.count === 0" class="widget-empty">
      <i class="ti ti-circle-check"></i>Every invoice is paid.
    </div>
    <ul v-else class="widget-list">
      <SaleRow v-for="sale in data?.items" :key="sale.id" :sale="sale" show-due />
    </ul>
  </WidgetCard>
</template>
