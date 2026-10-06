<script setup lang="ts">
// Card footer for paged lists: rows-per-page picker, "1–10 of 42", and page buttons.
import { computed } from 'vue'

const PAGE_SIZES = [10, 25, 50]

const props = defineProps<{ total: number; label: string }>() // label names the list for screen readers
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

const pageCount = computed(() => Math.max(Math.ceil(props.total / pageSize.value), 1))
const rangeStart = computed(() => (props.total === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, props.total))

/** Page numbers to show, with null for a "…" gap: 1 … 4 5 6 … 10 */
const pageButtons = computed<(number | null)[]>(() => {
  const last = pageCount.value
  const current = page.value
  const pages = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((p) => p >= 1 && p <= last)
    .sort((a, b) => a - b)
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1]! > 1 ? [null, p] : [p]))
})
</script>

<template>
  <div class="card-footer d-flex flex-wrap align-items-center justify-content-between gap-2">
    <div class="d-flex align-items-center gap-2 fs-14">
      <span class="text-nowrap">Rows per page</span>
      <select v-model.number="pageSize" class="form-select form-select-sm page-size" aria-label="Rows per page">
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
      <span class="text-gray-5 text-nowrap">{{ rangeStart }}–{{ rangeEnd }} of {{ total }}</span>
    </div>
    <nav :aria-label="label">
      <ul class="pagination pagination-sm mb-0">
        <li class="page-item" :class="{ disabled: page <= 1 }">
          <button type="button" class="page-link" aria-label="Previous page" @click="page--">
            <i class="ti ti-chevron-left"></i>
          </button>
        </li>
        <li
          v-for="(p, i) in pageButtons"
          :key="p ?? `gap-${i}`"
          class="page-item"
          :class="{ active: p === page, disabled: p === null }"
        >
          <span v-if="p === null" class="page-link">…</span>
          <button v-else type="button" class="page-link" @click="page = p">{{ p }}</button>
        </li>
        <li class="page-item" :class="{ disabled: page >= pageCount }">
          <button type="button" class="page-link" aria-label="Next page" @click="page++">
            <i class="ti ti-chevron-right"></i>
          </button>
        </li>
      </ul>
    </nav>
  </div>
</template>

<style scoped>
.page-size {
  width: auto;
}

.pagination .page-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border-radius: 50% !important;
  border: 0;
  margin: 0 2px;
  color: #646b72;
  background: transparent;
}

.pagination .page-item.active .page-link {
  background: #fe9f43;
  color: #ffffff;
}

.pagination .page-item.disabled .page-link {
  opacity: 0.4;
}
</style>
