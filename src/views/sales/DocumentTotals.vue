<script setup lang="ts">
// Subtotal, discount, tax and total for a sale or quotation form. The parent parses the
// discount and tax text (see utils/money.ts) and passes the totals worked out from them.
import { formatPeso } from '@/api/products'
import type { Totals } from '@/api/sales'

defineProps<{ totals: Totals; discountError: string; taxError: string }>()
const discount = defineModel<string>('discount', { required: true }) // pesos, e.g. "25.00"
const tax = defineModel<string>('tax', { required: true }) // percent, e.g. "12"
</script>

<template>
  <div class="totals">
    <div class="totals-row">
      <span>Subtotal</span>
      <span class="fw-medium text-gray-9">{{ formatPeso(totals.subtotalCents) }}</span>
    </div>
    <div class="totals-row">
      <label for="totals-discount">Discount</label>
      <div class="totals-input">
        <div class="input-group input-group-sm">
          <span class="input-group-text">₱</span>
          <input
            id="totals-discount"
            v-model="discount"
            type="text"
            class="form-control text-end"
            inputmode="decimal"
            placeholder="0.00"
            :class="{ 'is-invalid': discountError }"
          />
        </div>
      </div>
    </div>
    <div v-if="discountError" class="text-danger fs-12 text-end mb-1">{{ discountError }}</div>
    <div class="totals-row">
      <label for="totals-tax">Tax rate</label>
      <div class="totals-input">
        <div class="input-group input-group-sm">
          <input
            id="totals-tax"
            v-model="tax"
            type="text"
            class="form-control text-end"
            inputmode="decimal"
            placeholder="0"
            :class="{ 'is-invalid': taxError }"
          />
          <span class="input-group-text">%</span>
        </div>
      </div>
    </div>
    <div v-if="taxError" class="text-danger fs-12 text-end mb-1">{{ taxError }}</div>
    <div v-if="totals.taxCents > 0" class="totals-row">
      <span>Tax</span>
      <span class="text-gray-9">{{ formatPeso(totals.taxCents) }}</span>
    </div>
    <div class="totals-row totals-grand">
      <span>Total</span>
      <span>{{ formatPeso(totals.totalCents) }}</span>
    </div>
  </div>
</template>

<style scoped>
.totals-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.totals-row label {
  margin: 0;
}

.totals-input {
  width: 150px;
  max-width: 60%;
}

.totals-grand {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid #e6eaed;
  color: #212b36;
  font-size: 18px;
  font-weight: 700;
}
</style>
