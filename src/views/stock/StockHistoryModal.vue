<script setup lang="ts">
// Every stock adjustment of one product, newest first.
import { ref, watch } from 'vue'
import { formatQuantity, type Product } from '@/api/products'
import {
  formatChange,
  formatDateTime,
  listStockAdjustments,
  reasonLabel,
  type StockAdjustment,
} from '@/api/stock'
import AppModal from '@/components/AppModal.vue'
import ListPager from '@/components/ListPager.vue'

const props = defineProps<{ product: Product }>()
const emit = defineEmits<{ close: [] }>()

const items = ref<StockAdjustment[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const page = ref(1)
const pageSize = ref(10)

let latestRequest = 0

async function load() {
  const requestId = ++latestRequest
  loading.value = true
  loadError.value = ''
  try {
    const result = await listStockAdjustments({
      search: '',
      reason: '',
      direction: '',
      productId: props.product.id,
      from: null,
      to: null,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (requestId !== latestRequest) return
    items.value = result.items
    total.value = result.total
  } catch (e) {
    if (requestId === latestRequest) loadError.value = e instanceof Error ? e.message : 'Could not load the history'
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

watch(pageSize, () => {
  if (page.value === 1) load()
  else page.value = 1
})
watch(page, load)
load()
</script>

<template>
  <AppModal title="Stock History" size="lg" @close="emit('close')">
    <div class="modal-body p-0">
      <div class="history-product">
        <div class="min-w-0">
          <div class="fw-medium text-gray-9 text-break">{{ product.name }}</div>
          <div class="fs-12 text-gray-5">{{ product.sku }}</div>
        </div>
        <div class="text-end flex-shrink-0">
          <div class="fs-12 text-gray-5">In stock</div>
          <div class="fw-medium text-gray-9">{{ formatQuantity(product.quantity) }} {{ product.unit.shortName }}</div>
        </div>
      </div>

      <div v-if="loadError" class="alert alert-danger m-3 py-2" role="alert">{{ loadError }}</div>

      <div :class="{ 'is-loading': loading }">
        <div v-for="entry in items" :key="entry.id" class="history-row">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9">{{ reasonLabel(entry.reason) }}</div>
              <div class="fs-12 text-gray-5">
                {{ entry.reference }} · {{ formatDateTime(entry.createdAt) }} · {{ entry.userName }}
              </div>
            </div>
            <div class="text-end flex-shrink-0">
              <div class="fw-semibold" :class="entry.quantityChange > 0 ? 'text-success' : 'text-danger'">
                {{ formatChange(entry.quantityChange) }} {{ entry.unitShortName }}
              </div>
              <div class="fs-12 text-gray-5 text-nowrap">
                {{ formatQuantity(entry.quantityBefore) }} → {{ formatQuantity(entry.quantityAfter) }}
              </div>
            </div>
          </div>
          <div v-if="entry.note" class="fs-13 text-gray-7 mt-1 text-break">{{ entry.note }}</div>
        </div>

        <div v-if="!loading && !loadError && items.length === 0" class="text-center text-gray-5 py-5">
          <i class="ti ti-history fs-24 d-block mb-2"></i>
          No stock changes recorded yet.
        </div>
      </div>
    </div>
    <ListPager
      v-if="total > 0"
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      label="Stock history pages"
    />
  </AppModal>
</template>

<style scoped>
.history-product {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e6eaed;
  background: #f9fafb;
}

.history-row {
  padding: 12px 16px;
  border-bottom: 1px solid #e6eaed;
}

.history-row:last-child {
  border-bottom: 0;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}
</style>
