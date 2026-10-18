<script setup lang="ts">
// A report's bar chart: one bar per day or month. Plain HTML bars (like the dashboard's Sales
// Trend), so it stretches to any width; hover or tap a bar for its numbers. Negative values
// (a loss on the profit chart) hang below the zero line in red.
import { computed, ref } from 'vue'
import type { ReportChart } from '@/api/reports'
import { parseIsoDate } from '@/utils/date'
import { formatMoney, formatMoneyCompact } from '@/utils/money'
import { formatPeriodKey } from './format'

const props = defineProps<{ chart: ReportChart }>()

const active = ref<number | null>(null)
const points = computed(() => props.chart.points)

/** A round number at or above `value` (1, 2, 2.5, 5 × 10ⁿ), so the gridlines read cleanly */
function niceCeil(value: number): number {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value)! * magnitude
}

const axisMax = computed(() => niceCeil(Math.max(...points.value.map((p) => p.value), 0)))
const axisMin = computed(() => -niceCeil(-Math.min(...points.value.map((p) => p.value), 0)))
const span = computed(() => axisMax.value - axisMin.value || (props.chart.format === 'money' ? 100_00 : 10))
/** Where zero sits, as a percent from the top */
const zeroTop = computed(() => (axisMax.value / span.value) * 100)

const formatValue = (value: number) =>
  props.chart.format === 'money' ? formatMoney(value) : value.toLocaleString()
const formatAxis = (value: number) =>
  props.chart.format === 'money' ? formatMoneyCompact(value) : Math.round(value).toLocaleString()

const axisLabels = computed(() => {
  const top = axisMin.value < 0 ? axisMax.value : span.value
  const labels = [{ value: top, top: 0 }]
  if (axisMin.value < 0 && axisMax.value > 0) labels.push({ value: 0, top: zeroTop.value })
  if (axisMin.value === 0 || axisMax.value === 0) labels.push({ value: top - span.value / 2, top: 50 })
  labels.push({ value: top - span.value, top: 100 })
  return labels
})

const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })

/** Axis labels thin out as the bars get narrow, always keeping the last one */
function xLabel(index: number): string {
  const n = points.value.length
  const step = n <= 8 ? 1 : n <= 16 ? 2 : n <= 35 ? 5 : n <= 70 ? 10 : Math.ceil(n / 7)
  if ((n - 1 - index) % step !== 0) return ''
  const key = points.value[index]!.key
  if (props.chart.granularity === 'month') {
    const date = parseIsoDate(`${key}-01`)
    return n > 12 || date.getMonth() === 0 ? `${shortMonth.format(date)} ’${String(date.getFullYear()).slice(2)}` : shortMonth.format(date)
  }
  return n <= 7 ? weekday.format(parseIsoDate(key)) : shortDay.format(parseIsoDate(key))
}

function barStyle(value: number) {
  const height = (Math.abs(value) / span.value) * 100
  return value >= 0
    ? { top: `${zeroTop.value - height}%`, height: `${height}%` }
    : { top: `${zeroTop.value}%`, height: `${height}%` }
}

function tooltipStyle(index: number) {
  const left = ((index + 0.5) / points.value.length) * 100
  const shift = left < 15 ? '0%' : left > 85 ? '-100%' : '-50%'
  return { left: `${left}%`, transform: `translateX(${shift})` }
}

function toggle(index: number) {
  active.value = active.value === index ? null : index
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <h5 class="card-title mb-0 fs-16">{{ chart.title }}</h5>
    </div>
    <div class="card-body">
      <div class="chart" @mouseleave="active = null">
        <div class="y-axis" aria-hidden="true">
          <span v-for="label in axisLabels" :key="label.top" :style="{ top: `${label.top}%` }">{{ formatAxis(label.value) }}</span>
        </div>
        <div class="plot">
          <div class="grid-line" style="top: 0"></div>
          <div class="grid-line" :style="{ top: axisMin < 0 ? '100%' : '50%' }"></div>
          <div class="grid-line baseline" :style="{ top: `${zeroTop}%` }"></div>
          <div class="bars" :class="{ dense: points.length > 16 }">
            <button
              v-for="(point, i) in points"
              :key="point.key"
              type="button"
              class="bar-slot"
              :class="{ active: active === i, dim: active !== null && active !== i }"
              :aria-label="`${formatPeriodKey(point.key)}: ${formatValue(point.value)}`"
              @mouseenter="active = i"
              @focus="active = i"
              @blur="active = null"
              @click="toggle(i)"
            >
              <span class="bar" :class="{ negative: point.value < 0 }" :style="barStyle(point.value)"></span>
            </button>
          </div>
          <div v-if="active !== null && points[active]" class="chart-tooltip" :style="tooltipStyle(active)" role="status">
            <div class="fs-12 text-gray-5">{{ formatPeriodKey(points[active]!.key) }}</div>
            <div class="fw-bold" :class="points[active]!.value < 0 ? 'text-danger' : 'text-gray-9'">
              {{ formatValue(points[active]!.value) }}
            </div>
            <div v-if="chart.countLabel" class="fs-12 text-gray-5">
              {{ (points[active]!.count ?? 0).toLocaleString() }} {{ chart.countLabel }}
            </div>
          </div>
        </div>
      </div>
      <div class="x-axis" aria-hidden="true">
        <span v-for="(point, i) in points" :key="point.key">{{ xLabel(i) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart {
  display: flex;
  gap: 8px;
  height: 240px;
}

.y-axis {
  position: relative;
  flex-shrink: 0;
  width: 56px; /* fixed, so the x-axis below lines up */
  font-size: 11px;
  color: #8a9199;
  line-height: 1;
}

.y-axis span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  white-space: nowrap;
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
  border-top: 1px solid #d5dadf;
}

.bars {
  position: absolute;
  inset: 0;
  display: flex;
}

.bar-slot {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.bar {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 2px);
  max-width: 36px;
  border-radius: 3px;
  background: #fe9f43;
  transition: opacity 0.15s;
}

.bars:not(.dense) .bar {
  width: calc(100% - 10px);
}

.bar.negative {
  background: #ef4444;
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
  margin-left: 64px; /* y-axis width + gap */
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
    height: 190px;
  }

  .y-axis {
    width: 48px;
  }

  .x-axis {
    margin-left: 56px;
  }
}
</style>
