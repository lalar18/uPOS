<script setup lang="ts">
// One report (/reports/:key). Every report has the same parts: summary tiles, a chart,
// breakdowns and tables, so this page draws them all. The filters live in the URL, so a
// report can be refreshed, bookmarked or shared with the same dates.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getReport, type Report, type ReportTile } from '@/api/reports'
import { can, currentUser } from '@/auth'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { periodDates, rangeError, REPORT_PERIOD_OPTIONS, type Period } from '@/utils/period'
import { formatCell } from './format'
import { findReport } from './reports'
import ReportChart from './ReportChart.vue'
import ReportTable from './ReportTable.vue'

const props = defineProps<{ reportKey: string }>()

const route = useRoute()
const router = useRouter()
const today = toIsoDate()

const def = computed(() => findReport(props.reportKey))
const allowed = computed(() => !!def.value && (!def.value.permission || can(def.value.permission)))

// --- Filters (kept in the URL) ---

const queryText = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const isPeriod = (value: string): value is Exclude<Period, ''> => REPORT_PERIOD_OPTIONS.some((p) => p.value === value)

const period = ref<Exclude<Period, ''>>(isPeriod(queryText('period')) ? (queryText('period') as Exclude<Period, ''>) : 'month')
// A custom range starts on this month, so the date inputs aren't empty
const customFrom = ref(queryText('from') || `${today.slice(0, 8)}01`)
const customTo = ref(queryText('to') || today)
const options = ref<Record<string, string>>({})

function readOptions() {
  options.value = Object.fromEntries(
    (def.value?.options ?? []).map((o) => {
      const value = queryText(o.key)
      return [o.key, o.choices.some((c) => c.value === value) ? value : o.choices[0]!.value]
    }),
  )
}
readOptions()

const customRangeError = computed(() => rangeError(period.value, customFrom.value, customTo.value))
const range = computed(() => periodDates(period.value, customFrom.value, customTo.value))
const rangeLabel = computed(() => {
  if (!def.value?.dated) return `As of ${formatIsoDate(today)}`
  const { from, to } = range.value
  if (!from || !to) return ''
  return from === to ? formatIsoDate(from) : `${formatIsoDate(from)} – ${formatIsoDate(to)}`
})

// --- Loading ---

const report = ref<Report | null>(null)
const loading = ref(false)
const loadError = ref('')
let latestRequest = 0

async function load() {
  if (!def.value || !allowed.value) return
  const requestId = ++latestRequest
  loadError.value = ''
  const params: Record<string, string> = { today }
  if (def.value.dated) {
    const { from, to } = range.value
    if (customRangeError.value || !from || !to) {
      report.value = null
      loading.value = false
      return
    }
    params.from = from
    params.to = to
  }
  for (const [key, value] of Object.entries(options.value)) if (value) params[key] = value

  loading.value = true
  try {
    const result = await getReport(def.value.key, params)
    if (requestId === latestRequest) report.value = result
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load the report'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

function syncUrl() {
  const query: Record<string, string> = { ...options.value }
  if (def.value?.dated) {
    query.period = period.value
    if (period.value === 'custom') {
      if (customFrom.value) query.from = customFrom.value
      if (customTo.value) query.to = customTo.value
    }
  }
  for (const key of Object.keys(query)) if (!query[key]) delete query[key]
  router.replace({ query })
}

watch([period, customFrom, customTo, options], () => {
  syncUrl()
  load()
}, { deep: true })

// Another report opened from the sidebar reuses this page
watch(
  () => props.reportKey,
  () => {
    report.value = null
    readOptions()
    load()
  },
)

load()

// --- Printing: hide the header and sidebar while this page is open ---

onMounted(() => document.body.classList.add('report-page'))
onBeforeUnmount(() => document.body.classList.remove('report-page'))

const print = () => window.print()

// --- Display helpers ---

const TONES: Record<NonNullable<ReportTile['tone']>, string> = {
  primary: 'tone-primary',
  success: 'tone-success',
  danger: 'tone-danger',
  info: 'tone-info',
  warning: 'tone-warning',
}

/** 3 tiles per row on tablets; 4–6 across on wide screens */
const tileClass = computed(() => {
  const n = report.value?.tiles.length ?? 4
  return n >= 6 ? 'col-6 col-md-4 col-xxl-2' : n === 5 ? 'col-6 col-md-4 col-xl' : 'col-6 col-xl-3'
})

const breakdownMax = (items: { value: number }[]) => Math.max(...items.map((i) => Math.abs(i.value)), 1)
const breakdownTotal = (items: { value: number }[]) => items.reduce((sum, i) => sum + i.value, 0)
const percentOf = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0)

const fileName = computed(() => {
  const { from, to } = range.value
  return def.value?.dated && from && to ? `${def.value.key}-${from}-to-${to}` : `${def.value?.key ?? 'report'}-${today}`
})
</script>

<template>
  <div v-if="!def" class="card">
    <div class="card-body text-center text-gray-5 py-5">
      <i class="ti ti-report-off fs-24 d-block mb-2"></i>
      This report doesn't exist.
      <RouterLink :to="{ name: 'reports' }" class="d-block mt-2">See all reports</RouterLink>
    </div>
  </div>

  <template v-else>
    <div class="page-header flex-wrap gap-2">
      <div class="page-title">
        <RouterLink :to="{ name: 'reports' }" class="back-link fs-13 no-print"><i class="ti ti-arrow-left me-1"></i>Reports</RouterLink>
        <h4>{{ def.title }}</h4>
        <h6>{{ def.description }}</h6>
      </div>
      <div class="page-actions d-flex align-items-center gap-2 no-print">
        <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
          <i class="ti ti-refresh"></i>
        </button>
        <button type="button" class="btn btn-white border" title="Print" :disabled="!report" @click="print">
          <i class="ti ti-printer me-1"></i>Print
        </button>
      </div>
    </div>

    <div v-if="!allowed" class="card">
      <div class="card-body text-center text-gray-5 py-5">
        <i class="ti ti-lock fs-24 d-block mb-2"></i>
        This report shows cost prices, so it needs the <strong>Manage products</strong> permission.
      </div>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="card filters-card no-print">
        <div class="card-body py-3">
          <div class="d-flex flex-wrap align-items-center gap-2">
            <select v-if="def.dated" v-model="period" class="form-select filter-select" aria-label="Period">
              <option v-for="p in REPORT_PERIOD_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            <template v-if="def.dated && period === 'custom'">
              <input v-model="customFrom" type="date" class="form-control date-input" aria-label="From date" :max="today" />
              <span class="text-gray-5 d-none d-sm-inline">to</span>
              <input v-model="customTo" type="date" class="form-control date-input" aria-label="To date" :max="today" />
            </template>
            <select
              v-for="option in def.options"
              :key="option.key"
              v-model="options[option.key]"
              class="form-select filter-select"
              :aria-label="option.label"
            >
              <option v-for="choice in option.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
            </select>
            <span class="range-label ms-md-auto fs-13 text-gray-5">
              <i class="ti ti-calendar me-1"></i>{{ rangeLabel }}
            </span>
          </div>
          <div v-if="customRangeError" class="text-danger fs-13 mt-2">{{ customRangeError }}</div>
        </div>
      </div>

      <!-- Printed heading -->
      <div class="print-only mb-3">
        <div class="fw-bold fs-18">{{ currentUser?.store.name }} · {{ def.title }}</div>
        <div class="text-gray-6">{{ rangeLabel }}</div>
      </div>

      <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between gap-2" role="alert">
        <span>{{ loadError }}</span>
        <button type="button" class="btn btn-sm btn-outline-danger no-print" @click="load">Try again</button>
      </div>

      <div v-if="loading && !report" class="text-center text-gray-5 py-5">
        <span class="spinner-border spinner-border-sm me-2"></span>Loading report…
      </div>

      <div v-if="report" :class="{ 'is-loading': loading }">
        <!-- Summary tiles -->
        <div class="row g-3 mb-3">
          <div v-for="tile in report.tiles" :key="tile.label" :class="tileClass">
            <div class="stat-card">
              <span class="stat-icon" :class="TONES[tile.tone ?? 'primary']"><i class="ti" :class="`ti-${tile.icon}`"></i></span>
              <div class="min-w-0">
                <div class="fs-13 text-gray-5 text-truncate">{{ tile.label }}</div>
                <div class="stat-value" :class="{ 'text-danger': (tile.value ?? 0) < 0 }" :title="formatCell(tile.value, tile.format)">
                  {{ formatCell(tile.value, tile.format) }}
                </div>
                <div v-if="tile.hint" class="fs-12 text-gray-5 text-truncate" :title="tile.hint">{{ tile.hint }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Chart and breakdowns -->
        <div v-if="report.chart || report.breakdowns.length" class="row g-3 mb-3">
          <div v-if="report.chart" :class="report.breakdowns.length ? 'col-12 col-xl-8' : 'col-12'">
            <ReportChart :chart="report.chart" class="h-100 mb-0" />
          </div>
          <div
            v-for="breakdown in report.breakdowns"
            :key="breakdown.title"
            :class="report.chart ? 'col-12 col-xl-4' : 'col-12 col-lg-6'"
          >
            <div class="card h-100 mb-0">
              <div class="card-header">
                <h5 class="card-title mb-0 fs-16">{{ breakdown.title }}</h5>
              </div>
              <div class="card-body">
                <div v-if="breakdown.items.length === 0" class="text-center text-gray-5 py-4 fs-14">Nothing to show.</div>
                <ul v-else class="list-unstyled mb-0">
                  <li v-for="item in breakdown.items" :key="item.label" class="mb-3">
                    <div class="d-flex justify-content-between gap-2 fs-13 mb-1">
                      <span class="fw-medium text-gray-9 text-truncate" :title="formatCell(item.label, breakdown.labelFormat)">
                        {{ formatCell(item.label, breakdown.labelFormat) }}
                      </span>
                      <span class="text-gray-7 text-nowrap">
                        {{ formatCell(item.value, breakdown.format) }}
                        <span v-if="breakdown.format !== 'percent'" class="text-gray-5">· {{ percentOf(item.value, breakdownTotal(breakdown.items)) }}%</span>
                      </span>
                    </div>
                    <div class="track" :title="item.hint">
                      <div class="fill" :style="{ width: `${(Math.abs(item.value) / breakdownMax(breakdown.items)) * 100}%` }"></div>
                    </div>
                    <div v-if="item.hint" class="fs-12 text-gray-5 mt-1">{{ item.hint }}</div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <ReportTable v-for="table in report.tables" :key="table.title" :table="table" :file-name="fileName" />

        <ul v-if="report.notes.length" class="notes fs-13 text-gray-5">
          <li v-for="note in report.notes" :key="note">{{ note }}</li>
        </ul>
      </div>
    </template>
  </template>
</template>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  color: #646b72;
  margin-bottom: 4px;
}

.back-link:hover {
  color: #fe9f43;
}

.filter-select {
  width: auto;
  min-width: 150px;
}

.date-input {
  width: auto;
  min-width: 150px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  font-size: 20px;
}

.tone-primary {
  background: #fff6ee;
  color: #fe9f43;
}

.tone-success {
  background: #eafaf2;
  color: #3eb780;
}

.tone-danger {
  background: #ffeeec;
  color: #ef4444;
}

.tone-info {
  background: #e8f4fd;
  color: #2b8ae6;
}

.tone-warning {
  background: #fff8e5;
  color: #d39a00;
}

.stat-value {
  color: #212b36;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track {
  height: 8px;
  border-radius: 4px;
  background: #f2f4f6;
  overflow: hidden;
}

.fill {
  height: 100%;
  min-width: 4px;
  border-radius: 4px;
  background: #fe9f43;
  transition: width 0.3s ease;
}

.notes {
  padding-left: 18px;
  margin-bottom: 24px;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

.print-only {
  display: none;
}

@media (max-width: 767.98px) {
  .filter-select,
  .date-input {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .range-label {
    width: 100%;
  }

  .stat-card {
    padding: 12px;
    gap: 10px;
  }

  .stat-icon {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }

  .stat-value {
    font-size: 15px;
  }
}

@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions .btn:last-child {
    flex: 1;
  }
}

@media print {
  .print-only {
    display: block;
  }

  .is-loading {
    opacity: 1;
  }
}
</style>

<style>
/* While a report is open, printing shows only the report (no header, sidebar or buttons) */
@media print {
  body.report-page .header,
  body.report-page .sidebar,
  body.report-page .sidebar-overlay,
  body.report-page .no-print {
    display: none !important;
  }

  body.report-page .page-wrapper {
    margin: 0 !important;
    padding: 0 !important;
  }

  body.report-page .page-wrapper .content {
    padding: 0 !important;
  }

  body.report-page .card {
    box-shadow: none !important;
  }

  body.report-page .stat-card,
  body.report-page .chart {
    break-inside: avoid;
  }

  body.report-page .table-responsive.d-none {
    display: block !important;
  }

  body.report-page .d-md-none {
    display: none !important;
  }
}
</style>
