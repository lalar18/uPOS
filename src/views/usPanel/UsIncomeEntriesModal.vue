<script setup lang="ts">
// Each payment the platform's income came from in a year (see UsIncomeView.vue): subscriptions,
// and the service charges on sales paid online. Filtered by month, store and source; opened for
// a month or a store from the Income page, or for the whole year.
import { ref, watch } from 'vue'
import { paymentMethodLabel } from '@/api/sales'
import { storeCode } from '@/api/store'
import { formatDate } from '@/api/subscription'
import { getIncomeEntries, type IncomeEntries, type IncomeEntry, type IncomeSource } from '@/api/usPanel'
import AppModal from '@/components/AppModal.vue'
import { formatMoney } from '@/utils/money'

const props = defineProps<{
  year: number
  stores: { id: number; name: string }[] // stores with income that year, for the filter
  month?: number | null // 1-12
  store?: number | null
}>()
const emit = defineEmits<{ close: [] }>()

const month = ref<number | null>(props.month ?? null)
const store = ref<number | null>(props.store ?? null)
const source = ref<IncomeSource | null>(null)
const entries = ref<IncomeEntries | null>(null)
const loading = ref(false)
const loadError = ref('')
let latestRequest = 0

async function load(more = false) {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await getIncomeEntries({
      year: props.year,
      month: month.value,
      store: store.value,
      source: source.value,
      offset: more ? (entries.value?.entries.length ?? 0) : 0,
    })
    if (requestId !== latestRequest) return
    entries.value = more && entries.value ? { ...result, entries: [...entries.value.entries, ...result.entries] } : result
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load the income entries'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}
watch([month, store, source], () => load())
load()

const peso = (cents: number) => formatMoney(cents, 'PHP')

const monthNames = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' }))

function entryDetail(entry: IncomeEntry): string {
  if (entry.source === 'sale') return `${entry.saleReference} · sale paid online`
  const months = entry.months ? ` · ${entry.months} month${entry.months === 1 ? '' : 's'}` : ''
  return `${entry.planName ?? 'Plan'}${months}`
}
</script>

<template>
  <AppModal :title="`Income Entries · ${year}`" size="xl" @close="emit('close')">
    <div class="modal-body">
      <div class="d-flex flex-wrap gap-2 mb-3">
        <select v-model="month" class="form-select form-select-sm w-auto" aria-label="Month">
          <option :value="null">All of {{ year }}</option>
          <option v-for="(name, i) in monthNames" :key="name" :value="i + 1">{{ name }}</option>
        </select>
        <select v-model="store" class="form-select form-select-sm w-auto" aria-label="Store">
          <option :value="null">All stores</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <select v-model="source" class="form-select form-select-sm w-auto" aria-label="Source">
          <option :value="null">All sources</option>
          <option value="subscription">Subscriptions</option>
          <option value="sale">Sales paid online</option>
        </select>
      </div>

      <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>

      <div class="entries table-responsive border rounded">
        <table class="table us-stack mb-0" :class="{ 'is-loading': loading }">
          <thead class="thead-light">
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Source</th>
              <th>Paid with</th>
              <th class="text-end">Received</th>
              <th class="text-end">Income</th>
              <th class="text-end">PayMongo fee</th>
              <th class="text-end">Net income</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in entries?.entries ?? []" :key="`${e.source}-${e.id}`">
              <td class="text-nowrap fw-medium text-gray-9">{{ formatDate(e.at) }}</td>
              <td data-label="Store">
                <RouterLink :to="{ name: 'us-store', params: { id: e.storeId } }" class="text-gray-9" @click="emit('close')">
                  {{ e.storeName }}
                </RouterLink>
                <div class="fs-12 text-gray-5">{{ storeCode(e.storeId) }}</div>
              </td>
              <td data-label="Source">
                <span class="badge" :class="e.source === 'sale' ? 'bg-info-transparent text-info' : 'bg-primary-transparent text-primary'">
                  {{ e.source === 'sale' ? 'Sale service charge' : 'Subscription' }}
                </span>
                <div class="fs-12 text-gray-5">{{ entryDetail(e) }}</div>
              </td>
              <td data-label="Paid with">
                {{ paymentMethodLabel(e.method) }}
                <div class="fs-12 text-gray-5">
                  {{ e.online ? 'Online (PayMongo)' : 'Recorded by hand' }}<template v-if="e.reference"> · {{ e.reference }}</template>
                </div>
              </td>
              <td class="text-end" data-label="Received">
                {{ peso(e.receivedCents) }}
                <div v-if="e.storeCents" class="fs-12 text-gray-5">{{ peso(e.storeCents) }} for the store</div>
              </td>
              <td class="text-end" data-label="Income">
                {{ peso(e.subscriptionCents + e.chargeCents) }}
                <div v-if="e.source === 'subscription' && e.chargeCents" class="fs-12 text-gray-5">
                  incl. {{ peso(e.chargeCents) }} service charge
                </div>
                <div v-else-if="e.source === 'sale'" class="fs-12 text-gray-5">service charge</div>
              </td>
              <td class="text-end text-danger" data-label="PayMongo fee">{{ e.processingFeeCents ? `−${peso(e.processingFeeCents)}` : peso(0) }}</td>
              <td class="text-end fw-bold text-gray-9" data-label="Net income">{{ peso(e.netCents) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="entries && entries.count">
            <tr class="fw-bold">
              <td colspan="5">Total · {{ entries.count }} {{ entries.count === 1 ? 'entry' : 'entries' }}</td>
              <td class="text-end" data-label="Income">{{ peso(entries.totals.subscriptionsCents + entries.totals.chargesCents) }}</td>
              <td class="text-end text-danger" data-label="PayMongo fees">
                {{ entries.totals.processingFeesCents ? `−${peso(entries.totals.processingFeesCents)}` : peso(0) }}
              </td>
              <td class="text-end text-gray-9" data-label="Net income">{{ peso(entries.totals.netCents) }}</td>
            </tr>
          </tfoot>
        </table>
        <div v-if="entries && !loading && entries.count === 0" class="text-center text-gray-5 py-5">
          <i class="ti ti-list-search fs-24 d-block mb-2"></i>No income entries for these filters.
        </div>
        <div v-if="entries?.hasMore" class="text-center py-3 border-top">
          <button type="button" class="btn btn-sm btn-white border" :disabled="loading" @click="load(true)">
            {{ loading ? 'Loading…' : `Show more (${entries.entries.length} of ${entries.count})` }}
          </button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-primary" @click="emit('close')">Close</button>
    </div>
  </AppModal>
</template>

<style scoped>
.entries {
  max-height: 60vh;
  overflow-y: auto;
}

.entries thead th {
  position: sticky;
  top: 0;
  z-index: 1;
}

.entries tfoot td {
  position: sticky;
  bottom: 0;
  background: #fff;
}

/* Rows are cards on phones (.us-stack), so the totals row stays in place */
@media (max-width: 767.98px) {
  .entries tfoot td {
    position: static;
    background: transparent;
  }
}
</style>
