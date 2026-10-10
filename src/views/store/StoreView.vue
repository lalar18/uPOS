<script setup lang="ts">
// Store information for the logged-in user's store. Roles with store.manage can edit; others see it read-only.
import { computed, ref } from 'vue'
import { parseDbDate } from '@/api/http'
import { paymentMethodLabel } from '@/api/sales'
import { getOnlinePayouts, getStore, updateStore, type PayoutSummary, type Store, type StoreInput } from '@/api/store'
import { can, currentUser, isAdmin } from '@/auth'
import { formatMoney } from '@/utils/money'

const canEdit = computed(() => can('store.manage'))

const store = ref<Store | null>(null)
const form = ref<StoreInput>(toInput(null))
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saveSuccess = ref('')
const saving = ref(false)

function toInput(s: Store | null): StoreInput {
  return {
    name: s?.name ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    address: s?.address ?? '',
    city: s?.city ?? '',
    province: s?.province ?? '',
    postalCode: s?.postalCode ?? '',
    tin: s?.tin ?? '',
  }
}

const isDirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(toInput(store.value)))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    store.value = await getStore()
    form.value = toInput(store.value)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the store'
  } finally {
    loading.value = false
  }
}
load()

async function save() {
  saveError.value = ''
  saveSuccess.value = ''
  if (!form.value.name.trim()) {
    saveError.value = 'Store name is required.'
    return
  }

  saving.value = true
  try {
    store.value = await updateStore(form.value)
    form.value = toInput(store.value)
    // The header shows the store name
    if (currentUser.value) currentUser.value.store.name = store.value.name
    saveSuccess.value = 'Store information saved.'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save the store'
  } finally {
    saving.value = false
  }
}

function reset() {
  form.value = toInput(store.value)
  saveError.value = ''
  saveSuccess.value = ''
}

// Sales paid online go to the platform's PayMongo account, which pays them out to the store (admins only)
const payouts = ref<PayoutSummary | null>(null)
if (isAdmin()) {
  getOnlinePayouts()
    .then((result) => (payouts.value = result))
    .catch(() => {})
}
const hasOnlineSales = computed(
  () => !!payouts.value && (payouts.value.onlinePayments > 0 || payouts.value.payouts.length > 0),
)
const peso = (cents: number) => formatMoney(cents, 'PHP')

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatDate = (value: string) => dateFormat.format(parseDbDate(value))
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Store Information</h4>
      <h6>{{ canEdit ? 'Manage your store details' : 'Your store details' }}</h6>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between" role="alert">
    {{ loadError }}
    <button type="button" class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
  </div>

  <div v-else class="card" :class="{ 'is-loading': loading }">
    <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0"><i class="ti ti-building-store me-2"></i>{{ store?.name ?? 'Store' }}</h5>
      <span v-if="store" class="fs-12 text-gray-5">Last updated {{ formatDate(store.updatedAt) }}</span>
    </div>
    <form @submit.prevent="save">
      <fieldset class="card-body" :disabled="!canEdit || loading || saving">
        <div v-if="saveError" class="alert alert-danger py-2" role="alert">{{ saveError }}</div>
        <div v-if="saveSuccess" class="alert alert-success py-2" role="alert">{{ saveSuccess }}</div>

        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-name">Store Name <span class="text-danger">*</span></label>
            <input id="store-name" v-model="form.name" type="text" class="form-control" maxlength="100" required />
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-tin">TIN</label>
            <input
              id="store-tin"
              v-model="form.tin"
              type="text"
              class="form-control"
              maxlength="20"
              inputmode="numeric"
              pattern="[0-9\-]+"
              title="Numbers and dashes only"
              placeholder="000-000-000-00000"
            />
            <div class="form-text">Taxpayer Identification Number, shown on receipts.</div>
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-email">Email</label>
            <input id="store-email" v-model="form.email" type="email" class="form-control" maxlength="254" />
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="store-phone">Phone</label>
            <input
              id="store-phone"
              v-model="form.phone"
              type="tel"
              class="form-control"
              maxlength="30"
              pattern="[0-9+()\-\s]+"
              title="Numbers, spaces and + ( ) - only"
              placeholder="0917 123 4567"
            />
          </div>
          <div class="col-12 mb-3">
            <label class="form-label" for="store-address">Address</label>
            <input
              id="store-address"
              v-model="form.address"
              type="text"
              class="form-control"
              maxlength="255"
              placeholder="Unit / building, street, barangay"
            />
          </div>
          <div class="col-md-5 mb-3">
            <label class="form-label" for="store-city">City / Municipality</label>
            <input id="store-city" v-model="form.city" type="text" class="form-control" maxlength="100" />
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label" for="store-province">Province</label>
            <input id="store-province" v-model="form.province" type="text" class="form-control" maxlength="100" />
          </div>
          <div class="col-md-3 mb-3">
            <label class="form-label" for="store-postal-code">Postal Code</label>
            <input
              id="store-postal-code"
              v-model="form.postalCode"
              type="text"
              class="form-control"
              maxlength="10"
              inputmode="numeric"
            />
          </div>
        </div>

        <div v-if="canEdit" class="d-flex justify-content-end gap-2">
          <button type="button" class="btn btn-secondary" :disabled="!isDirty" @click="reset">Discard Changes</button>
          <button type="submit" class="btn btn-primary" :disabled="!isDirty">
            {{ saving ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
        <p v-else class="fs-12 text-gray-5 mb-0">Your role doesn't allow changing store information.</p>
      </fieldset>
    </form>
  </div>

  <!-- Online payments held by the platform until paid out -->
  <div v-if="payouts && hasOnlineSales" class="card">
    <div class="card-header">
      <h5 class="card-title mb-0"><i class="ti ti-credit-card me-2"></i>Online Payments</h5>
    </div>
    <div class="card-body">
      <p class="fs-14 text-gray-5">
        Sales paid online (card, GCash, Maya through PayMongo) are collected by the platform and paid out to your store.
        Service charges aren't included: they go to the platform.
      </p>
      <div class="row g-2 mb-3 text-center">
        <div class="col-4">
          <div class="stat">
            <div class="fs-12 text-gray-5">Paid online</div>
            <div class="fw-bold text-gray-9">{{ peso(payouts.collectedCents) }}</div>
            <div class="fs-12 text-gray-5">{{ payouts.onlinePayments }} payment{{ payouts.onlinePayments === 1 ? '' : 's' }}</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat">
            <div class="fs-12 text-gray-5">Paid out to you</div>
            <div class="fw-bold text-gray-9">{{ peso(payouts.paidOutCents) }}</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat">
            <div class="fs-12 text-gray-5">Still to be paid out</div>
            <div class="fw-bold" :class="payouts.balanceCents > 0 ? 'text-primary' : 'text-success'">
              {{ peso(payouts.balanceCents) }}
            </div>
          </div>
        </div>
      </div>
      <div v-if="payouts.refundsDue.length" class="alert alert-warning py-2 fs-14" role="alert">
        {{ payouts.refundsDue.length }} online payment{{ payouts.refundsDue.length === 1 ? ' was' : 's were' }} made after
        the sale was already paid ({{ payouts.refundsDue.map((r) => r.sale.reference).join(', ') }}). The platform will refund
        the customer.
      </div>
      <h6 class="mb-2">Payouts</h6>
      <div v-if="!payouts.payouts.length" class="text-gray-5 fs-14">No payouts yet.</div>
      <div v-for="p in payouts.payouts" :key="p.id" class="payout-row">
        <div class="min-w-0">
          <div class="text-gray-9">{{ p.reference }} · {{ paymentMethodLabel(p.method) }}</div>
          <div class="fs-12 text-gray-5 text-break">
            {{ p.paidDate }}<template v-if="p.paymentReference"> · Ref {{ p.paymentReference }}</template>
          </div>
        </div>
        <div class="fw-semibold text-nowrap">{{ peso(p.amountCents) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

fieldset {
  min-width: 0;
}

.stat {
  padding: 10px;
  border-radius: 8px;
  background: #f9fafb;
}

.payout-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #e6eaed;
}

.min-w-0 {
  min-width: 0;
}
</style>
