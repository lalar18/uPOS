<script setup lang="ts">
// Headline numbers: today's and this month's sales, money collected, and what customers still owe.
import { computed } from 'vue'
import type { SalesOverview } from '@/api/dashboard'
import { formatMoney } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const { data, loading, error, load } = useWidget<SalesOverview>('sales-overview')

/** "+12%" against the earlier period; null when there's nothing to compare with */
function change(now: number, before: number): { text: string; up: boolean } | null {
  if (before <= 0) return null
  const percent = Math.round(((now - before) / before) * 100)
  return { text: `${percent >= 0 ? '+' : ''}${percent}%`, up: percent >= 0 }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      label: "Today's sales",
      value: formatMoney(d.today.cents),
      note: plural(d.today.count, 'sale'),
      change: change(d.today.cents, d.today.yesterdayCents),
      versus: 'vs yesterday',
      icon: 'cash',
      color: 'primary',
      to: '/sales',
    },
    {
      label: 'Sales this month',
      value: formatMoney(d.month.cents),
      note: plural(d.month.count, 'sale'),
      change: change(d.month.cents, d.month.lastMonthCents),
      versus: 'vs last month',
      icon: 'chart-bar',
      color: 'success',
      to: '/sales',
    },
    {
      label: 'Collected this month',
      value: formatMoney(d.collectedCents),
      note: 'Payments, less refunds',
      change: null,
      versus: '',
      icon: 'wallet',
      color: 'info',
      to: '/sales',
    },
    {
      label: 'Receivables',
      value: formatMoney(d.receivable.cents),
      note: `${d.receivable.count} unpaid${d.receivable.overdue ? ` · ${d.receivable.overdue} overdue` : ''}`,
      change: null,
      versus: '',
      icon: 'file-invoice',
      color: d.receivable.overdue ? 'danger' : 'warning',
      to: '/invoices',
    },
  ]
})
</script>

<template>
  <WidgetCard v-if="error" title="Sales Overview" icon="chart-bar" :error="error" @retry="load" />
  <div v-else class="row g-3" :class="{ 'is-loading': loading && data }">
    <div v-for="tile in tiles" :key="tile.label" class="col-6 col-xl-3">
      <RouterLink :to="tile.to" class="card stat-card h-100 mb-0">
        <div class="card-body">
          <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
            <span class="fs-13 text-gray-5">{{ tile.label }}</span>
            <span class="stat-icon" :class="`bg-${tile.color}-transparent text-${tile.color}`">
              <i class="ti" :class="`ti-${tile.icon}`"></i>
            </span>
          </div>
          <div class="stat-value fw-bold text-gray-9 text-break">{{ tile.value }}</div>
          <div class="fs-12 text-gray-5 mt-1">
            <template v-if="tile.change">
              <span class="fw-medium text-nowrap" :class="tile.change.up ? 'text-success' : 'text-danger'">
                <i class="ti" :class="tile.change.up ? 'ti-trending-up' : 'ti-trending-down'"></i>
                {{ tile.change.text }}
              </span>
              {{ tile.versus }} ·
            </template>
            {{ tile.note }}
          </div>
        </div>
      </RouterLink>
    </div>
    <!-- Placeholders during the first load, so the page doesn't jump -->
    <template v-if="!data">
      <div v-for="n in 4" :key="n" class="col-6 col-xl-3">
        <div class="card h-100 mb-0 placeholder-card"></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-card {
  color: inherit;
  transition: box-shadow 0.15s;
}

.stat-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 18px;
}

.stat-value {
  font-size: 22px;
  line-height: 1.2;
}

.placeholder-card {
  min-height: 118px;
  background: #f7f8f9;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

@media (max-width: 575.98px) {
  .stat-card .card-body {
    padding: 12px;
  }

  .stat-value {
    font-size: 17px;
  }

  .stat-icon {
    width: 30px;
    height: 30px;
    font-size: 16px;
  }
}
</style>
