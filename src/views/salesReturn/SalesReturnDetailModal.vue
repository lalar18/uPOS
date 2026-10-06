<script setup lang="ts">
// Details of one sales return.
import { ref } from 'vue'
import { formatPeso, formatQuantity } from '@/api/products'
import { getSalesReturn, returnReasonLabel, type SalesReturn } from '@/api/salesReturns'
import { formatDateTime } from '@/api/stock'
import AppModal from '@/components/AppModal.vue'
import { formatIsoDate } from '@/utils/date'

const props = defineProps<{ id: number }>()
const emit = defineEmits<{ close: [] }>()

const salesReturn = ref<SalesReturn | null>(null)
const error = ref('')

getSalesReturn(props.id)
  .then((result) => (salesReturn.value = result))
  .catch((e) => (error.value = e instanceof Error ? e.message : 'Could not load the return'))
</script>

<template>
  <AppModal :title="salesReturn ? `Sales Return ${salesReturn.reference}` : 'Sales Return'" size="lg" @close="emit('close')">
    <div class="modal-body">
      <div v-if="error" class="alert alert-danger py-2 mb-0" role="alert">{{ error }}</div>
      <div v-else-if="!salesReturn" class="text-center text-gray-5 py-4">Loading…</div>

      <template v-else>
        <div class="info-grid mb-3">
          <div>
            <div class="fs-12 text-gray-5">Sale</div>
            <RouterLink :to="{ name: 'sale-detail', params: { id: salesReturn.sale.id } }" class="fw-medium" @click="emit('close')">
              {{ salesReturn.sale.reference }}
            </RouterLink>
          </div>
          <div>
            <div class="fs-12 text-gray-5">Customer</div>
            <div class="fw-medium text-gray-9 text-break">{{ salesReturn.customer.name }}</div>
          </div>
          <div>
            <div class="fs-12 text-gray-5">Return date</div>
            <div class="fw-medium text-gray-9">{{ formatIsoDate(salesReturn.returnDate) }}</div>
          </div>
          <div>
            <div class="fs-12 text-gray-5">Reason</div>
            <div class="fw-medium text-gray-9">{{ returnReasonLabel(salesReturn.reason) }}</div>
          </div>
        </div>

        <div class="items mb-3">
          <div v-for="item in salesReturn.items" :key="item.id" class="item">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ item.name }}</div>
              <div class="fs-12 text-gray-5">
                {{ item.sku }} · {{ formatQuantity(item.quantity) }} {{ item.unitShortName }} × {{ formatPeso(item.priceCents) }}
                <template v-if="item.productId === null"> · deleted</template>
              </div>
            </div>
            <div class="fw-medium text-nowrap">{{ formatPeso(item.totalCents) }}</div>
          </div>
        </div>

        <div class="totals">
          <div class="d-flex justify-content-between">
            <span>Credited to the sale</span><span class="fw-semibold text-gray-9">{{ formatPeso(salesReturn.totalCents) }}</span>
          </div>
          <div class="d-flex justify-content-between mt-1">
            <span>Refunded</span>
            <span class="fw-semibold" :class="salesReturn.refundCents > 0 ? 'text-danger' : 'text-gray-5'">
              {{ formatPeso(salesReturn.refundCents) }}
            </span>
          </div>
          <div class="fs-12 text-gray-5 mt-2">
            {{ salesReturn.restock ? 'Items were put back in stock.' : 'Items were not put back in stock.' }}
            Credit includes the sale's discount and tax, in proportion.
          </div>
        </div>

        <div v-if="salesReturn.note" class="mt-3">
          <div class="fs-12 text-gray-5">Note</div>
          <div class="text-break note">{{ salesReturn.note }}</div>
        </div>
        <div class="fs-12 text-gray-5 mt-3">
          Recorded by {{ salesReturn.userName }} · {{ formatDateTime(salesReturn.createdAt) }}
        </div>
      </template>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" @click="emit('close')">Close</button>
    </div>
  </AppModal>
</template>

<style scoped>
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (min-width: 768px) {
  .info-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.items {
  border: 1px solid #e6eaed;
  border-radius: 8px;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e6eaed;
}

.item:last-child {
  border-bottom: 0;
}

.totals {
  padding: 12px 14px;
  border-radius: 8px;
  background: #f9fafb;
}

.note {
  white-space: pre-line;
}

.min-w-0 {
  min-width: 0;
}
</style>
