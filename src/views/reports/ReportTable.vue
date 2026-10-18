<script setup lang="ts">
// One table of a report: a sortable table on tablets and up, stacked cards on phones.
// Long tables get a search box and show PAGE rows at a time; every table downloads as CSV.
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { ReportColumn, ReportRow, ReportTable } from '@/api/reports'
import { downloadCsv, formatCell, isNumeric } from './format'

const props = defineProps<{ table: ReportTable; fileName: string }>()

const PAGE = 50
const SEARCH_FROM = 10 // rows before the search box shows

const search = ref('')
const shown = ref(PAGE)
const sortKey = ref<string | null>(null)
const sortDesc = ref(true)

watch(
  () => props.table,
  () => {
    search.value = ''
    shown.value = PAGE
    sortKey.value = null
  },
)
watch(search, () => (shown.value = PAGE))

const textColumns = computed(() => props.table.columns.filter((c) => !isNumeric(c)))
/** The headline value on a phone card: the last money column, else the last number */
const mainColumn = computed(() => {
  const numeric = props.table.columns.filter(isNumeric).filter((c) => c.format !== 'percent')
  return numeric.filter((c) => c.format === 'money').at(-1) ?? numeric.at(-1) ?? null
})
const titleColumn = computed(() => props.table.columns[0]!)
const detailColumns = computed(() =>
  props.table.columns.filter((c) => c !== titleColumn.value && c !== mainColumn.value),
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  let rows = props.table.rows
  if (q) {
    rows = rows.filter((row) =>
      textColumns.value.some((c) => formatCell(row[c.key] ?? null, c.format).toLowerCase().includes(q)),
    )
  }
  if (sortKey.value) {
    const key = sortKey.value
    const direction = sortDesc.value ? -1 : 1
    rows = [...rows].sort((a, b) => {
      const x = a[key] ?? null
      const y = b[key] ?? null
      if (x === y) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * direction
    })
  }
  return rows
})
const visible = computed(() => filtered.value.slice(0, shown.value))

function sortBy(column: ReportColumn) {
  if (sortKey.value === column.key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = column.key
    sortDesc.value = isNumeric(column) // numbers biggest first, text A–Z
  }
}

const cell = (row: ReportRow, column: ReportColumn) => formatCell(row[column.key] ?? null, column.format)
const isNegative = (row: ReportRow, column: ReportColumn) => typeof row[column.key] === 'number' && (row[column.key] as number) < 0
const rowLink = (row: ReportRow) =>
  props.table.link ? { name: props.table.link.route, params: { id: String(row[props.table.link.idKey]) } } : null
</script>

<template>
  <div class="card report-table">
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0 fs-16">
        {{ table.title }}
        <span class="fs-13 fw-normal text-gray-5">({{ table.rows.length.toLocaleString() }}{{ table.truncated ? '+' : '' }})</span>
      </h5>
      <div class="d-flex align-items-center gap-2 table-tools no-print">
        <div v-if="table.rows.length > SEARCH_FROM" class="search-input">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input v-model="search" type="search" class="form-control form-control-sm" placeholder="Search" :aria-label="`Search ${table.title}`" />
        </div>
        <button
          type="button"
          class="btn btn-sm btn-white border text-nowrap"
          :disabled="table.rows.length === 0"
          title="Download as CSV"
          @click="downloadCsv(table, `${fileName}-${table.title}.csv`)"
        >
          <i class="ti ti-download me-1"></i>CSV
        </button>
      </div>
    </div>

    <div class="card-body p-0">
      <div v-if="table.rows.length === 0" class="text-center text-gray-5 py-4 fs-14">
        <i class="ti ti-database-off fs-20 d-block mb-1"></i>Nothing to show for this period.
      </div>

      <template v-else>
        <!-- Table (tablets and up) -->
        <div class="table-responsive d-none d-md-block">
          <table class="table table-hover mb-0">
            <thead class="thead-light">
              <tr>
                <th
                  v-for="column in table.columns"
                  :key="column.key"
                  :class="{ 'text-end': isNumeric(column) }"
                  :aria-sort="sortKey === column.key ? (sortDesc ? 'descending' : 'ascending') : 'none'"
                >
                  <button type="button" class="sort-button" @click="sortBy(column)">
                    {{ column.label }}
                    <i
                      class="ti"
                      :class="sortKey === column.key ? (sortDesc ? 'ti-chevron-down' : 'ti-chevron-up') : 'ti-selector text-gray-4'"
                    ></i>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in visible" :key="i">
                <td
                  v-for="(column, c) in table.columns"
                  :key="column.key"
                  :class="{ 'text-end': isNumeric(column), 'text-danger': isNegative(row, column), 'name-cell': c === 0 }"
                >
                  <RouterLink v-if="c === 0 && rowLink(row)" :to="rowLink(row)!" class="fw-medium">{{ cell(row, column) }}</RouterLink>
                  <template v-else>{{ cell(row, column) }}</template>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="table.totals && !search">
              <tr>
                <td
                  v-for="column in table.columns"
                  :key="column.key"
                  :class="{ 'text-end': isNumeric(column), 'text-danger': isNegative(table.totals, column) }"
                >
                  {{ table.totals[column.key] === undefined ? '' : cell(table.totals, column) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Cards (phones) -->
        <div class="d-md-none">
          <component
            :is="rowLink(row) ? RouterLink : 'div'"
            v-for="(row, i) in visible"
            :key="i"
            :to="rowLink(row) ?? undefined"
            class="row-card"
          >
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div class="fw-semibold text-break" :class="rowLink(row) ? 'text-primary' : 'text-gray-9'">
                {{ cell(row, titleColumn) }}
              </div>
              <div
                v-if="mainColumn"
                class="fw-semibold text-nowrap"
                :class="isNegative(row, mainColumn) ? 'text-danger' : 'text-gray-9'"
              >
                {{ cell(row, mainColumn) }}
              </div>
            </div>
            <dl class="row-details">
              <template v-for="column in detailColumns" :key="column.key">
                <dt>{{ column.label }}</dt>
                <dd :class="{ 'text-danger': isNegative(row, column) }">{{ cell(row, column) }}</dd>
              </template>
            </dl>
          </component>
          <div v-if="table.totals && !search" class="row-card totals-card">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div class="fw-bold text-gray-9">{{ cell(table.totals, titleColumn) }}</div>
              <div v-if="mainColumn && table.totals[mainColumn.key] !== undefined" class="fw-bold text-nowrap" :class="isNegative(table.totals, mainColumn) ? 'text-danger' : 'text-gray-9'">
                {{ cell(table.totals, mainColumn) }}
              </div>
            </div>
            <dl class="row-details">
              <template v-for="column in detailColumns" :key="column.key">
                <template v-if="table.totals[column.key] !== undefined">
                  <dt>{{ column.label }}</dt>
                  <dd>{{ cell(table.totals, column) }}</dd>
                </template>
              </template>
            </dl>
          </div>
        </div>

        <div v-if="search && filtered.length === 0" class="text-center text-gray-5 py-4 fs-14">Nothing matches “{{ search }}”.</div>

        <div v-if="filtered.length > shown" class="text-center p-3 border-top no-print">
          <button type="button" class="btn btn-sm btn-outline-primary" @click="shown += PAGE">
            Show more ({{ (filtered.length - shown).toLocaleString() }} left)
          </button>
        </div>
        <div v-if="table.truncated" class="fs-12 text-gray-5 px-3 py-2 border-top">
          Showing the first {{ table.rows.length.toLocaleString() }} rows. Download the CSV or narrow the dates for the rest.
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.table td,
.table th {
  vertical-align: middle;
  white-space: nowrap;
}

.name-cell {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
}

tfoot td {
  font-weight: 700;
  color: #212b36;
  background: #f9fafb;
  border-top: 2px solid #e6eaed;
}

.search-input {
  position: relative;
}

.search-input .search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #a6aaaf;
  pointer-events: none;
}

.search-input input {
  padding-left: 30px;
  width: 200px;
}

.row-card {
  display: block;
  padding: 12px 16px;
  border-bottom: 1px solid #e6eaed;
  color: inherit;
}

.row-card:last-child {
  border-bottom: 0;
}

.totals-card {
  background: #f9fafb;
}

.row-details {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 6px 0 0;
  font-size: 12px;
}

.row-details dt {
  font-weight: 400;
  color: #8a9199;
}

.row-details dd {
  margin: 0;
  text-align: right;
  color: #3c4650;
  word-break: break-word;
}

@media (max-width: 767.98px) {
  .table-tools,
  .search-input {
    flex: 1 1 auto;
  }

  .search-input input {
    width: 100%;
  }
}
</style>
