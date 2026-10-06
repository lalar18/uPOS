<script setup lang="ts">
// Picks a customer, or none for a walk-in customer. Searches as you type and can add a new one.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listCustomers, type Customer, type PickedCustomer } from '@/api/customers'
import { WALK_IN_CUSTOMER } from '@/api/sales'
import CustomerFormModal from './CustomerFormModal.vue'

const props = defineProps<{ id?: string; disabled?: boolean }>()
const customer = defineModel<PickedCustomer | null>({ required: true })

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const search = ref('')
const results = ref<Customer[]>([])
const searching = ref(false)
const searchError = ref('')
const adding = ref(false)
let latestSearch = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch() {
  const requestId = ++latestSearch
  searching.value = true
  searchError.value = ''
  try {
    const result = await listCustomers({ search: search.value.trim(), status: 'active', page: 1, pageSize: 8 })
    if (requestId === latestSearch) results.value = result.items
  } catch (e) {
    if (requestId === latestSearch) searchError.value = e instanceof Error ? e.message : 'Could not search customers'
  } finally {
    if (requestId === latestSearch) searching.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    search.value = ''
    runSearch()
  }
}

function pick(value: PickedCustomer | null) {
  customer.value = value
  open.value = false
}

function onAdded(added: Customer) {
  adding.value = false
  pick({ id: added.id, name: added.name, phone: added.phone })
}

function closeOnOutside(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutside))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  clearTimeout(searchTimer)
})
</script>

<template>
  <div ref="root" class="customer-picker" @keydown.esc.stop="open = false">
    <button
      :id="id"
      type="button"
      class="form-select picker-toggle"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <i class="ti ti-user text-gray-5"></i>
      <span class="text-truncate">{{ customer?.name ?? WALK_IN_CUSTOMER }}</span>
      <span v-if="customer?.phone" class="fs-12 text-gray-5 text-truncate d-none d-sm-inline">{{ customer.phone }}</span>
    </button>

    <div v-if="open" class="picker-menu">
      <div class="p-2 border-bottom">
        <input
          v-model="search"
          type="search"
          class="form-control form-control-sm"
          placeholder="Search name, phone or email"
          aria-label="Search customers"
          autocomplete="off"
          autofocus
        />
      </div>
      <div class="picker-options" role="listbox" :class="{ 'is-loading': searching }">
        <button type="button" class="picker-option" role="option" :aria-selected="customer === null" @click="pick(null)">
          <i class="ti ti-walk text-gray-5"></i><span>{{ WALK_IN_CUSTOMER }}</span>
        </button>
        <button
          v-for="item in results"
          :key="item.id"
          type="button"
          class="picker-option"
          role="option"
          :aria-selected="customer?.id === item.id"
          @click="pick({ id: item.id, name: item.name, phone: item.phone })"
        >
          <i class="ti ti-user text-gray-5"></i>
          <span class="min-w-0">
            <span class="d-block text-truncate text-gray-9">{{ item.name }}</span>
            <span v-if="item.phone" class="d-block fs-12 text-gray-5 text-truncate">{{ item.phone }}</span>
          </span>
        </button>
        <div v-if="searchError" class="text-danger fs-13 p-2">{{ searchError }}</div>
        <div v-else-if="!searching && search.trim() && results.length === 0" class="text-gray-5 fs-13 p-2 text-center">
          No customers found.
        </div>
      </div>
      <button type="button" class="picker-add" @click="adding = true">
        <i class="ti ti-circle-plus"></i>Add new customer
      </button>
    </div>

    <CustomerFormModal v-if="adding" :initial-name="search" @close="adding = false" @saved="onAdded" />
  </div>
</template>

<style scoped>
.customer-picker {
  position: relative;
}

.picker-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  text-align: left;
}

.picker-menu {
  position: absolute;
  z-index: 1000;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 240px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12);
  overflow: hidden;
}

.picker-options {
  max-height: 240px;
  overflow-y: auto;
}

.picker-option,
.picker-add {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: #ffffff;
  text-align: left;
}

.picker-option:hover,
.picker-option:focus-visible,
.picker-option[aria-selected='true'] {
  background: #fff6ee;
}

.picker-add {
  border-top: 1px solid #e6eaed;
  color: #fe9f43;
  font-weight: 500;
}

.picker-add:hover {
  background: #fff6ee;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.6;
}
</style>
