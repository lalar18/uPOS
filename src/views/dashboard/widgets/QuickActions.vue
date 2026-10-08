<script setup lang="ts">
// Shortcuts to the screens used most. Only shows what the user's role can do.
import { computed } from 'vue'
import type { Permission } from '@/api/roles'
import { can, subscriptionExpired } from '@/auth'
import WidgetCard from '../WidgetCard.vue'

interface Action {
  label: string
  to: string
  icon: string
  permission?: Permission
  writes?: boolean // closed while the subscription is expired
}

const ACTIONS: Action[] = [
  { label: 'POS', to: '/pos', icon: 'device-laptop', permission: 'sales.create', writes: true },
  { label: 'New Sale', to: '/sales/create', icon: 'shopping-cart-plus', permission: 'sales.create', writes: true },
  { label: 'New Quotation', to: '/quotations/create', icon: 'file-description', permission: 'quotations.manage', writes: true },
  { label: 'Add Product', to: '/products/create', icon: 'table-plus', permission: 'products.manage', writes: true },
  { label: 'Adjust Stock', to: '/stock/adjustments', icon: 'stairs-up', permission: 'stock.adjust' },
  { label: 'Customers', to: '/customers', icon: 'users-group' },
  { label: 'Products', to: '/products', icon: 'box' },
  { label: 'Sales', to: '/sales', icon: 'receipt-2' },
]

const actions = computed(() =>
  ACTIONS.filter((a) => (!a.permission || can(a.permission)) && !(a.writes && subscriptionExpired())),
)
</script>

<template>
  <WidgetCard title="Quick Actions" icon="bolt">
    <div class="actions">
      <RouterLink v-for="action in actions" :key="action.to" :to="action.to" class="action">
        <i class="ti" :class="`ti-${action.icon}`"></i>
        <span>{{ action.label }}</span>
      </RouterLink>
    </div>
  </WidgetCard>
</template>

<style scoped>
.actions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
}

.action {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 8px;
  border: 1px solid #e6eaed;
  border-radius: 10px;
  color: #212b36;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.action .ti {
  font-size: 22px;
  color: #fe9f43;
}

.action:hover,
.action:focus-visible {
  border-color: #fe9f43;
  background: rgba(254, 159, 67, 0.06);
}

@media (max-width: 575.98px) {
  .actions {
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .action {
    padding: 10px 4px;
    font-size: 12px;
  }
}

@media (max-width: 359.98px) {
  .actions {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
