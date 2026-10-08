<script setup lang="ts">
// Quotations still waiting for an answer (draft or sent, not past "valid until").
import type { OpenQuotations } from '@/api/dashboard'
import { formatIsoDate } from '@/utils/date'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<OpenQuotations>('quotations')

const reference = (id: number) => `QT-${String(id).padStart(5, '0')}`
</script>

<template>
  <WidgetCard
    title="Open Quotations"
    icon="file-description"
    flush
    :loading="loading"
    :error="error"
    :link="{ to: '/quotations' }"
    @retry="load"
  >
    <div v-if="data && data.count > 0" class="d-flex flex-wrap gap-3 px-3 pt-3 pb-2">
      <div>
        <div class="fs-12 text-gray-5">Open</div>
        <div class="fw-bold text-gray-9">{{ data.count }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Total value</div>
        <div class="fw-bold text-gray-9">{{ formatMoney(data.cents) }}</div>
      </div>
    </div>
    <div v-if="data && data.count === 0" class="widget-empty">
      <i class="ti ti-file-description"></i>No open quotations.
    </div>
    <ul v-else class="widget-list">
      <li v-for="q in data?.items" :key="q.id">
        <div class="min-w-0">
          <RouterLink :to="{ name: 'quotation-detail', params: { id: q.id } }" class="fw-medium">
            {{ reference(q.id) }}
          </RouterLink>
          <div class="fs-12 text-gray-5 text-truncate">
            {{ q.customerName }}<template v-if="q.validUntil"> · valid until {{ formatIsoDate(q.validUntil) }}</template>
          </div>
        </div>
        <div class="text-end flex-shrink-0">
          <div class="fw-semibold text-gray-9 text-nowrap">{{ formatMoney(q.totalCents) }}</div>
          <span class="badge" :class="q.status === 'sent' ? 'bg-info' : 'bg-secondary'">
            {{ q.status === 'sent' ? 'Sent' : 'Draft' }}
          </span>
        </div>
      </li>
    </ul>
  </WidgetCard>
</template>
