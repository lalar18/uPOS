<script setup lang="ts">
// Net sales per day (after returns) for the last 7 or 30 days, as a bar chart.
// Plain HTML bars, so the chart stretches to any width; hover or tap a bar for its numbers.
import { computed, ref } from 'vue'
import type { SalesTrend } from '@/api/dashboard'
import { parseIsoDate } from '@/utils/date'
import { formatMoney, formatMoneyCompact } from '@/utils/money'
import { useWidget } from '../useWidget'
import WidgetCard from '../WidgetCard.vue'

const days = ref<'7' | '30'>('30')
const { data, loading, error, load } = useWidget<SalesTrend>('sales-trend', () => ({ days: days.value }))

const active = ref<number | null>(null) // the bar whose tooltip is showing

const points = computed(() => data.value?.points ?? [])
const total = computed(() => points.value.reduce((sum, p) => sum + p.cents, 0))
const count = computed(() => points.value.reduce((sum, p) => sum + p.count, 0))
const best = computed(() => points.value.reduce((top, p) => (p.cents > (top?.cents ?? 0) ? p : top), null as SalesTrend['points'][number] | null))

/** A round number at or above the highest bar (1, 2, 2.5, 5 × 10ⁿ), so the gridlines read cleanly */
const axisMax = computed(() => {
  const max = Math.max(...points.value.map((p) => p.cents), 0)
  if (max <= 0) return 100_00
  const magnitude = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max)!
  return step * magnitude
})

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const longFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

const formatDay = (date: string) => dayFormat.format(parseIsoDate(date))
const formatLong = (date: string) => longFormat.format(parseIsoDate(date))

/** Axis labels: every weekday for 7 days; every 5th day (ending today) for 30 */
function xLabel(index: number): string {
  const p = points.value[index]!
  if (points.value.length <= 7) return weekdayFormat.format(parseIsoDate(p.date))
  return (points.value.length - 1 - index) % 5 === 0 ? formatDay(p.date) : ''
}

/** Keeps the tooltip inside the chart near either edge */
function tooltipStyle(index: number) {
  const n = points.value.length
  const left = ((index + 0.5) / n) * 100
  const shift = left < 15 ? '0%' : left > 85 ? '-100%' : '-50%'
  return { left: `${left}%`, transform: `translateX(${shift})` }
}

function toggle(index: number) {
  active.value = active.value === index ? null : index
}
</script>

<template>
  <WidgetCard title="Sales Trend" icon="chart-bar" :loading="loading" :error="error" @retry="load">
    <template #actions>
      <div class="btn-group btn-group-sm" role="group" aria-label="Period">
        <button
          v-for="option in (['7', '30'] as const)"
          :key="option"
          type="button"
          class="btn"
          :class="days === option ? 'btn-primary' : 'btn-outline-light text-gray-7 border'"
          :aria-pressed="days === option"
          @click="days = option"
        >
          {{ option }}d
        </button>
      </div>
    </template>

    <div class="summary d-flex flex-wrap gap-3 gap-sm-4 mb-3">
      <div>
        <div class="fs-12 text-gray-5">Net sales</div>
        <div class="fs-18 fw-bold text-gray-9">{{ formatMoney(total) }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Sales</div>
        <div class="fs-18 fw-bold text-gray-9">{{ count }}</div>
      </div>
      <div>
        <div class="fs-12 text-gray-5">Daily average</div>
        <div class="fs-18 fw-bold text-gray-9">{{ formatMoney(points.length ? Math.round(total / points.length) : 0) }}</div>
      </div>
      <div v-if="best">
        <div class="fs-12 text-gray-5">Best day</div>
        <div class="fs-18 fw-bold text-gray-9">{{ formatDay(best.date) }}</div>
      </div>
    </div>

    <div class="chart" @mouseleave="active = null">
      <div class="y-axis" aria-hidden="true">
        <span>{{ formatMoneyCompact(axisMax) }}</span>
        <span>{{ formatMoneyCompact(axisMax / 2) }}</span>
        <span>{{ formatMoneyCompact(0) }}</span>
      </div>
      <div class="plot">
        <div class="grid-line" style="top: 0"></div>
        <div class="grid-line" style="top: 50%"></div>
        <div class="grid-line baseline"></div>
        <div class="bars" :class="{ dense: points.length > 7 }">
          <button
            v-for="(point, i) in points"
            :key="point.date"
            type="button"
            class="bar-slot"
            :class="{ active: active === i, dim: active !== null && active !== i }"
            :aria-label="`${formatLong(point.date)}: ${formatMoney(point.cents)}, ${point.count} sales`"
            @mouseenter="active = i"
            @focus="active = i"
            @blur="active = null"
            @click="toggle(i)"
          >
            <span class="bar" :style="{ height: `${(point.cents / axisMax) * 100}%` }"></span>
          </button>
        </div>
        <div v-if="active !== null && points[active]" class="chart-tooltip" :style="tooltipStyle(active)" role="status">
          <div class="fs-12 text-gray-5">{{ formatLong(points[active]!.date) }}</div>
          <div class="fw-bold text-gray-9">{{ formatMoney(points[active]!.cents) }}</div>
          <div class="fs-12 text-gray-5">{{ points[active]!.count }} {{ points[active]!.count === 1 ? 'sale' : 'sales' }}</div>
        </div>
      </div>
    </div>
    <div class="x-axis" aria-hidden="true">
      <span v-for="(point, i) in points" :key="point.date">{{ xLabel(i) }}</span>
    </div>

    <!-- The same numbers for screen readers -->
    <table class="visually-hidden">
      <caption>Net sales per day</caption>
      <thead>
        <tr><th>Date</th><th>Net sales</th><th>Sales</th></tr>
      </thead>
      <tbody>
        <tr v-for="point in points" :key="point.date">
          <td>{{ formatLong(point.date) }}</td>
          <td>{{ formatMoney(point.cents) }}</td>
          <td>{{ point.count }}</td>
        </tr>
      </tbody>
    </table>
  </WidgetCard>
</template>

<style scoped>
.chart {
  display: flex;
  gap: 8px;
  height: 220px;
}

.y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  flex-shrink: 0;
  width: 52px; /* fixed, so the x-axis below lines up */
  white-space: nowrap;
  font-size: 11px;
  color: #8a9199;
  line-height: 1;
  transform: translateY(-1px);
}

.plot {
  position: relative;
  flex: 1;
  min-width: 0;
}

.grid-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed #e6eaed;
}

.grid-line.baseline {
  bottom: 0;
  border-top: 1px solid #d5dadf;
}

.bars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
}

.bar-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 1px; /* the 2px gap between neighbouring bars */
  border: 0;
  background: transparent;
  cursor: pointer;
}

.bar {
  display: block;
  width: 100%;
  max-width: 36px;
  border-radius: 4px 4px 0 0;
  background: #fe9f43;
  transition:
    opacity 0.15s,
    height 0.3s ease;
}

.bars:not(.dense) .bar-slot {
  padding: 0 6px;
}

.bar-slot.dim .bar {
  opacity: 0.45;
}

.bar-slot.active {
  background: rgba(254, 159, 67, 0.08);
}

.bar-slot:focus-visible {
  outline: 2px solid #fe9f43;
  outline-offset: -2px;
}

.chart-tooltip {
  position: absolute;
  top: 0;
  z-index: 2;
  padding: 8px 10px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  white-space: nowrap;
  pointer-events: none;
}

.x-axis {
  display: flex;
  margin-left: 60px; /* y-axis width + gap */
  margin-top: 6px;
  font-size: 11px;
  color: #8a9199;
}

.x-axis span {
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  overflow: visible;
}

@media (max-width: 575.98px) {
  .chart {
    height: 180px;
  }

  .summary .fs-18 {
    font-size: 15px !important;
  }
}
</style>
