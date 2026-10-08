<script setup lang="ts">
// The card around a dashboard widget: title, optional "View all" link, and loading / error states.
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  title: string
  icon: string // tabler icon name, without the "ti-" prefix
  loading?: boolean
  error?: string
  link?: { to: RouteLocationRaw; label?: string }
  flush?: boolean // the body has no padding (lists and tables)
}>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="card widget-card h-100 mb-0">
    <div class="card-header d-flex align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0 d-flex align-items-center gap-2 min-w-0">
        <span class="widget-icon"><i class="ti" :class="`ti-${icon}`"></i></span>
        <span class="text-truncate">{{ title }}</span>
      </h5>
      <div class="d-flex align-items-center gap-2 flex-shrink-0">
        <slot name="actions" />
        <RouterLink v-if="link" :to="link.to" class="fs-13 text-nowrap">{{ link.label ?? 'View all' }}</RouterLink>
      </div>
    </div>
    <div class="card-body" :class="{ 'p-0': flush && !error, 'is-loading': loading }">
      <div v-if="error" class="text-center py-4">
        <div class="text-danger fs-13 mb-2">{{ error }}</div>
        <button type="button" class="btn btn-sm btn-outline-danger" @click="emit('retry')">Retry</button>
      </div>
      <slot v-else />
    </div>
  </div>
</template>

<style scoped>
.widget-card .card-header {
  padding-top: 14px;
  padding-bottom: 14px;
}

.widget-card .card-title {
  font-size: 15px;
}

.widget-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(254, 159, 67, 0.12);
  color: #fe9f43;
  font-size: 16px;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}
</style>
