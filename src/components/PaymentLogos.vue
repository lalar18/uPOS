<script setup lang="ts">
// The logo of an online payment method (card shows Visa and Mastercard), so customers see the
// brand they're paying with. Renders nothing for methods without a logo (cash, cheque, ...).
// Logos are in public/assets/img/payments.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ method: string; height?: number }>(), { height: 24 })

const LOGOS: Record<string, { file: string; alt: string }[]> = {
  card: [
    { file: 'visa.svg', alt: 'Visa' },
    { file: 'mastercard.svg', alt: 'Mastercard' },
  ],
  gcash: [{ file: 'gcash.svg', alt: 'GCash' }],
  maya: [{ file: 'maya.svg', alt: 'Maya' }],
  qrph: [{ file: 'qrph.svg', alt: 'QR Ph' }],
}

const logos = computed(() => LOGOS[props.method] ?? [])
</script>

<template>
  <span v-if="logos.length" class="payment-logos">
    <img
      v-for="logo in logos"
      :key="logo.file"
      :src="`/assets/img/payments/${logo.file}`"
      :alt="logo.alt"
      :style="{ height: `${height}px` }"
      draggable="false"
    />
  </span>
</template>

<style scoped>
.payment-logos {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.payment-logos img {
  width: auto;
  max-width: 100%;
}
</style>
