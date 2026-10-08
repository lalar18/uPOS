<script setup lang="ts">
// One quotation (/quotations/:id): the document, its status, and actions to edit, print,
// convert it to a sale or delete it.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  deleteQuotation,
  getQuotation,
  QUOTATION_STATUSES,
  quotationBadge,
  quotationStatusLabel,
  setQuotationStatus,
  type EditableQuotationStatus,
  type Quotation,
} from '@/api/quotations'
import { formatDateTime } from '@/api/stock'
import { getStore, type Store } from '@/api/store'
import { can } from '@/auth'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import { formatIsoDate, toIsoDate } from '@/utils/date'
import { usePrintRoot } from '@/utils/print'
import InvoiceDocument from '../sales/InvoiceDocument.vue'

const props = defineProps<{ id: string }>()

const router = useRouter()
const canManage = computed(() => can('quotations.manage'))
const canDelete = computed(() => can('quotations.delete'))
const canSell = computed(() => can('sales.create'))
const today = toIsoDate()

const quotation = ref<Quotation | null>(null)
const store = ref<Store | null>(null)
const loadError = ref('')
const actionError = ref('')
const busy = ref(false)

getQuotation(Number(props.id))
  .then((result) => (quotation.value = result))
  .catch((e) => (loadError.value = e instanceof Error ? e.message : 'Could not load the quotation'))
getStore()
  .then((result) => (store.value = result))
  .catch(() => {})

usePrintRoot(() => '@page { size: A4; margin: 12mm; }')

const isConverted = computed(() => quotation.value?.status === 'converted')
const badge = computed(() => (quotation.value ? quotationBadge(quotation.value, today) : undefined))
const documentItems = computed(() => (quotation.value?.items ?? []).map((item) => ({ ...item, key: item.id })))
const dates = computed(() => {
  const q = quotation.value
  if (!q) return []
  const list = [{ label: 'Date', value: formatIsoDate(q.quoteDate) }]
  if (q.validUntil) list.push({ label: 'Valid until', value: formatIsoDate(q.validUntil) })
  return list
})

async function changeStatus(status: EditableQuotationStatus) {
  if (!quotation.value || status === quotation.value.status) return
  busy.value = true
  actionError.value = ''
  try {
    quotation.value = await setQuotationStatus(quotation.value.id, status)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Could not change the status'
  } finally {
    busy.value = false
  }
}

function print() {
  window.print()
}

const deleting = ref(false)
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ quotation?.reference ?? 'Quotation' }}</h4>
      <h6 v-if="quotation">{{ quotation.customer.name }} · {{ formatIsoDate(quotation.quoteDate) }}</h6>
    </div>
    <div class="page-actions d-flex flex-wrap align-items-center gap-2">
      <RouterLink :to="{ name: 'quotations' }" class="btn btn-white border"><i class="ti ti-arrow-left me-1"></i>Back</RouterLink>
      <template v-if="quotation">
        <button type="button" class="btn btn-white border" @click="print">
          <i class="ti ti-printer me-1"></i>Print
        </button>
        <template v-if="!isConverted">
          <RouterLink
            v-if="canManage"
            :to="{ name: 'quotation-edit', params: { id: quotation.id } }"
            class="btn btn-white border"
          >
            <i class="ti ti-edit me-1"></i>Edit
          </RouterLink>
          <button v-if="canDelete" type="button" class="btn btn-white border text-danger" @click="deleting = true">
            <i class="ti ti-trash me-1"></i>Delete
          </button>
          <RouterLink
            v-if="canSell && quotation.status !== 'declined'"
            :to="{ name: 'sale-create', query: { quotation: quotation.id } }"
            class="btn btn-primary"
          >
            <i class="ti ti-shopping-cart me-1"></i>Convert to Sale
          </RouterLink>
        </template>
        <RouterLink v-else-if="quotation.sale" :to="{ name: 'sale-detail', params: { id: quotation.sale.id } }" class="btn btn-primary">
          <i class="ti ti-file-invoice me-1"></i>View {{ quotation.sale.reference }}
        </RouterLink>
      </template>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="actionError" class="alert alert-danger py-2" role="alert">{{ actionError }}</div>
  <div v-if="!quotation && !loadError" class="card"><div class="card-body text-center text-gray-5 py-5">Loading…</div></div>

  <div v-if="quotation" class="row g-3">
    <div class="col-xl-8">
      <div class="card mb-0">
        <div class="card-body">
          <InvoiceDocument
            title="Quotation"
            :reference="quotation.reference"
            :store="store"
            :customer="quotation.customer"
            :dates="dates"
            :status="badge"
            :items="documentItems"
            :totals="quotation"
            :note="quotation.note"
          />
        </div>
      </div>
    </div>

    <div class="col-xl-4">
      <div class="card mb-0">
        <div class="card-body">
          <h5 class="card-title mb-3">Status</h5>
          <div v-if="isConverted" class="text-gray-9">
            Converted to
            <RouterLink v-if="quotation.sale" :to="{ name: 'sale-detail', params: { id: quotation.sale.id } }">
              {{ quotation.sale.reference }}
            </RouterLink>
            <span v-else>a sale</span>. It can no longer be changed.
          </div>
          <template v-else>
            <div class="status-picker" role="radiogroup" aria-label="Quotation status">
              <button
                v-for="s in QUOTATION_STATUSES"
                :key="s"
                type="button"
                role="radio"
                :aria-checked="quotation.status === s"
                :class="{ active: quotation.status === s }"
                :disabled="busy || !canManage"
                @click="changeStatus(s)"
              >
                {{ quotationStatusLabel(s) }}
              </button>
            </div>
            <div v-if="badge?.label === 'Expired'" class="fs-13 text-warning mt-2">
              Past its valid-until date. Edit it to extend the date if the offer still stands.
            </div>
          </template>
          <div class="fs-12 text-gray-5 mt-3">
            Prepared by {{ quotation.userName }} · {{ formatDateTime(quotation.createdAt) }}
            <template v-if="quotation.updatedAt !== quotation.createdAt">
              <br />Last changed {{ formatDateTime(quotation.updatedAt) }}
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- The copy that prints (hidden on screen) -->
  <Teleport to="body">
    <div v-if="quotation" class="print-root">
      <InvoiceDocument
        title="Quotation"
        :reference="quotation.reference"
        :store="store"
        :customer="quotation.customer"
        :dates="dates"
        :items="documentItems"
        :totals="quotation"
        :note="quotation.note"
      />
    </div>
  </Teleport>

  <ConfirmDeleteModal
    v-if="deleting && quotation"
    title="Delete Quotation"
    :item-name="quotation.reference"
    :action="() => deleteQuotation(quotation!.id)"
    @close="deleting = false"
    @deleted="router.replace({ name: 'quotations' })"
  />
</template>

<style scoped>
.status-picker {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.status-picker button {
  padding: 8px 6px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #646b72;
  font-weight: 500;
}

.status-picker button.active {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions > * {
    flex: 1 1 auto;
  }
}
</style>
