<script setup lang="ts">
// One store, for support: its subscription and billing, users, and contact details.
import { computed, ref } from 'vue'
import { paymentMethodLabel } from '@/api/sales'
import { storeCode } from '@/api/store'
import { describeSeats, formatDate, formatPrice, getPlans, type Plan } from '@/api/subscription'
import {
  cancelRenewal,
  getStore,
  listStoreRenewals,
  listStoreUsers,
  setStoreActive,
  setStoreUserActive,
  signOutStoreUsers,
  type Renewal,
  type StoreDetail,
  type StoreUser,
} from '@/api/usPanel'
import { relativeDays, renewalBadge, storeStatus } from './format'
import UsConfirmModal from './UsConfirmModal.vue'
import UsPaymentModal from './UsPaymentModal.vue'
import UsResetPasswordModal from './UsResetPasswordModal.vue'
import UsStoreInfoModal from './UsStoreInfoModal.vue'
import UsSubscriptionModal from './UsSubscriptionModal.vue'

const props = defineProps<{ id: number }>()

const store = ref<StoreDetail | null>(null)
const users = ref<StoreUser[]>([])
const renewals = ref<Renewal[]>([])
const plans = ref<Plan[]>([])
const loading = ref(false)
const loadError = ref('')
const notice = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [detail, userList, renewalList] = await Promise.all([
      getStore(props.id),
      listStoreUsers(props.id),
      listStoreRenewals(props.id),
    ])
    store.value = detail
    users.value = userList
    renewals.value = renewalList
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the store'
  } finally {
    loading.value = false
  }
}
load()
getPlans()
  .then((value) => (plans.value = value))
  .catch(() => (plans.value = []))

const status = computed(() => (store.value ? storeStatus(store.value) : null))
const pending = computed(() => renewals.value.find((r) => r.status === 'pending') ?? null)

const number = new Intl.NumberFormat('en-US')
const percent = (used: number, max: number) => `${Math.min(100, Math.round((used / Math.max(max, 1)) * 100))}%`

const address = computed(() => {
  const s = store.value
  if (!s) return ''
  return [s.address, s.city, s.province, s.postalCode].filter(Boolean).join(', ')
})

// --- Dialogs ---

const editingInfo = ref(false)
const editingSubscription = ref(false)
const recordingPayment = ref(false)
const confirmingRenewal = ref<Renewal | null>(null)
const resetting = ref<StoreUser | null>(null)
const confirm = ref<{
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<unknown>
  done: string
} | null>(null)

function onStoreSaved(detail: StoreDetail, message: string) {
  store.value = detail
  editingInfo.value = false
  editingSubscription.value = false
  notice.value = message
}

function onPaid(renewal: Renewal) {
  recordingPayment.value = false
  confirmingRenewal.value = null
  notice.value = `Payment recorded. The subscription now runs until ${renewal.periodEnd ? formatDate(renewal.periodEnd) : 'the new date'}.`
  load()
}

function askToggleStore() {
  const s = store.value!
  confirm.value = s.active
    ? {
        title: 'Disable Store',
        message: `Disable ${s.name}? None of its users can sign in until it's enabled again, and everyone signed in is signed out now. Its data is kept.`,
        confirmLabel: 'Disable Store',
        danger: true,
        action: () => setStoreActive(s.id, false),
        done: 'Store disabled.',
      }
    : {
        title: 'Enable Store',
        message: `Enable ${s.name}? Its active users can sign in again.`,
        confirmLabel: 'Enable Store',
        action: () => setStoreActive(s.id, true),
        done: 'Store enabled.',
      }
}

function askSignOutAll() {
  const s = store.value!
  confirm.value = {
    title: 'Sign Out Everyone',
    message: `Sign out every user of ${s.name} on every device? They can sign in again right away.`,
    confirmLabel: 'Sign Out All',
    action: () => signOutStoreUsers(s.id),
    done: 'Everyone in the store was signed out.',
  }
}

function askToggleUser(user: StoreUser) {
  const s = store.value!
  confirm.value = user.active
    ? {
        title: 'Deactivate User',
        message: `Deactivate ${user.fullName}? They're signed out and can't sign in until reactivated.${
          user.role.isAdmin ? ' Make sure the store keeps another active admin.' : ''
        }`,
        confirmLabel: 'Deactivate',
        danger: true,
        action: () => setStoreUserActive(s.id, user.id, false),
        done: `${user.fullName} was deactivated.`,
      }
    : {
        title: 'Activate User',
        message: `Activate ${user.fullName}? They can sign in again.`,
        confirmLabel: 'Activate',
        action: () => setStoreUserActive(s.id, user.id, true),
        done: `${user.fullName} was activated.`,
      }
}

function askCancelRenewal(renewal: Renewal) {
  confirm.value = {
    title: 'Cancel Renewal Request',
    message: `Cancel the ${renewal.plan.name} renewal request? The store admin can request again from their Subscription page.`,
    confirmLabel: 'Cancel Request',
    danger: true,
    action: () => cancelRenewal(renewal.id),
    done: 'Renewal request cancelled.',
  }
}

function onConfirmed() {
  notice.value = confirm.value?.done ?? ''
  confirm.value = null
  load()
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <RouterLink :to="{ name: 'us-stores' }" class="fs-13 text-gray-5 d-inline-flex align-items-center mb-1">
        <i class="ti ti-arrow-left me-1"></i>Stores
      </RouterLink>
      <h4 class="d-flex flex-wrap align-items-center gap-2">
        {{ store?.name ?? 'Store' }}
        <span v-if="status" class="badge" :class="status.class">{{ status.label }}</span>
      </h4>
      <h6>{{ storeCode(id) }}<template v-if="store"> · added {{ formatDate(store.createdAt) }}</template></h6>
    </div>
    <div v-if="store" class="page-actions d-flex flex-wrap align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
      <button type="button" class="btn btn-white border" @click="editingInfo = true">
        <i class="ti ti-edit me-1"></i>Edit Info
      </button>
      <button type="button" class="btn" :class="store.active ? 'btn-outline-danger' : 'btn-success'" @click="askToggleStore">
        <i class="ti me-1" :class="store.active ? 'ti-ban' : 'ti-circle-check'"></i>
        {{ store.active ? 'Disable Store' : 'Enable Store' }}
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>
  <div v-if="store && !store.active" class="alert alert-secondary py-2" role="status">
    <i class="ti ti-ban me-1"></i>This store is disabled: none of its users can sign in.
  </div>

  <template v-if="store">
    <!-- Renewal waiting for payment -->
    <div
      v-if="pending"
      class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2"
      role="status"
    >
      <div>
        <div class="fw-semibold">
          <i class="ti ti-hourglass me-1"></i>Renewal on the {{ pending.plan.name }} plan is waiting for payment
        </div>
        <div class="fs-13">
          Requested {{ formatDate(pending.createdAt) }}<template v-if="pending.requestedBy"> by {{ pending.requestedBy }}</template>
          · {{ formatPrice(pending.plan.monthlyPrice) }}/month
        </div>
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-white border" @click="askCancelRenewal(pending)">Cancel request</button>
        <button type="button" class="btn btn-sm btn-primary" @click="confirmingRenewal = pending">Confirm payment</button>
      </div>
    </div>

    <div class="row g-3">
      <!-- Subscription -->
      <div class="col-xl-8">
        <div class="card h-100 mb-0" :class="{ 'is-loading': loading }">
          <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
            <h5 class="card-title mb-0">Subscription</h5>
            <div class="d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm btn-white border" @click="editingSubscription = true">
                <i class="ti ti-adjustments me-1"></i>Change Plan / Expiry
              </button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="!!pending"
                :title="pending ? 'Confirm or cancel the waiting renewal first' : ''"
                @click="recordingPayment = true"
              >
                <i class="ti ti-cash me-1"></i>Record Payment
              </button>
            </div>
          </div>
          <div class="card-body">
            <div class="row g-3 mb-4">
              <div class="col-sm-4">
                <div class="fs-12 text-gray-5">Plan</div>
                <div class="fw-semibold">{{ store.plan.name }}</div>
                <div class="fs-13 text-gray-5">{{ formatPrice(store.plan.monthlyPrice) }}/month</div>
              </div>
              <div class="col-sm-4">
                <div class="fs-12 text-gray-5">{{ store.expired ? 'Expired' : 'Expires' }}</div>
                <div class="fw-semibold" :class="{ 'text-danger': store.expired }">
                  {{ store.expiresAt ? formatDate(store.expiresAt) : '—' }}
                </div>
                <div v-if="store.expiresAt" class="fs-13 text-gray-5">{{ relativeDays(store.expiresAt) }}</div>
              </div>
              <div class="col-sm-4">
                <div class="fs-12 text-gray-5">Seats</div>
                <div class="fw-semibold">{{ describeSeats(store.plan) }}</div>
              </div>
            </div>

            <div class="row g-4">
              <div class="col-md-6">
                <div class="d-flex justify-content-between fs-14 mb-1">
                  <span>Users ({{ store.usage.admins }} admin{{ store.usage.admins === 1 ? '' : 's' }})</span>
                  <span class="fw-medium">{{ store.usage.users }} / {{ store.plan.maxUsers }}</span>
                </div>
                <div class="progress" role="progressbar" aria-label="Users used">
                  <div
                    class="progress-bar"
                    :class="store.usage.users >= store.plan.maxUsers ? 'bg-danger' : 'bg-primary'"
                    :style="{ width: percent(store.usage.users, store.plan.maxUsers) }"
                  ></div>
                </div>
              </div>
              <div class="col-md-6">
                <div class="d-flex justify-content-between fs-14 mb-1">
                  <span>Products</span>
                  <span class="fw-medium">
                    {{ number.format(store.usage.products) }} / {{ number.format(store.plan.maxProducts) }}
                  </span>
                </div>
                <div class="progress" role="progressbar" aria-label="Products used">
                  <div
                    class="progress-bar"
                    :class="store.usage.products >= store.plan.maxProducts ? 'bg-danger' : 'bg-primary'"
                    :style="{ width: percent(store.usage.products, store.plan.maxProducts) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Contact and activity -->
      <div class="col-xl-4">
        <div class="card h-100 mb-0">
          <div class="card-header"><h5 class="card-title mb-0">Store details</h5></div>
          <div class="card-body">
            <dl class="mb-0 details">
              <dt>Email</dt>
              <dd class="text-break">{{ store.email ?? '—' }}</dd>
              <dt>Phone</dt>
              <dd>{{ store.phone ?? '—' }}</dd>
              <dt>Address</dt>
              <dd>{{ address || '—' }}</dd>
              <dt>TIN</dt>
              <dd>{{ store.tin ?? '—' }}</dd>
              <dt>Sales recorded</dt>
              <dd>
                {{ number.format(store.activity.sales) }}
                <span v-if="store.activity.lastSaleAt" class="text-gray-5">
                  · last {{ formatDate(store.activity.lastSaleAt) }}
                </span>
              </dd>
            </dl>
          </div>
        </div>
      </div>

      <!-- Users -->
      <div class="col-12">
        <div class="card mb-0">
          <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
            <h5 class="card-title mb-0">Users</h5>
            <button type="button" class="btn btn-sm btn-white border" @click="askSignOutAll">
              <i class="ti ti-logout me-1"></i>Sign Out Everyone
            </button>
          </div>
          <div class="table-responsive">
            <table class="table mb-0">
              <thead class="thead-light">
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Status</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id">
                  <td>
                    <div class="fw-medium text-gray-9">{{ user.fullName }}</div>
                    <div class="fs-12 text-gray-5">{{ user.email }}</div>
                  </td>
                  <td>
                    <span class="badge" :class="user.role.isAdmin ? 'bg-primary' : 'bg-secondary'">{{ user.role.name }}</span>
                  </td>
                  <td>{{ formatDate(user.createdAt) }}</td>
                  <td>
                    <span class="badge" :class="user.active ? 'bg-success' : 'bg-danger'">
                      {{ user.active ? 'Active' : 'Inactive' }}
                    </span>
                  </td>
                  <td class="text-end">
                    <div class="row-actions">
                      <button type="button" title="Reset password" @click="resetting = user">
                        <i class="ti ti-key"></i>
                      </button>
                      <button
                        type="button"
                        :title="user.active ? 'Deactivate' : 'Activate'"
                        @click="askToggleUser(user)"
                      >
                        <i class="ti" :class="user.active ? 'ti-user-off' : 'ti-user-check'"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="users.length === 0">
                  <td colspan="5" class="text-center text-gray-5 py-4">This store has no users.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Billing history -->
      <div class="col-12">
        <div class="card">
          <div class="card-header"><h5 class="card-title mb-0">Billing history</h5></div>
          <div class="table-responsive">
            <table class="table mb-0">
              <thead class="thead-light">
                <tr>
                  <th>Date</th>
                  <th>Plan</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="renewal in renewals" :key="renewal.id">
                  <td>{{ formatDate(renewal.paidAt ?? renewal.createdAt) }}</td>
                  <td>
                    {{ renewal.plan.name }}
                    <span class="text-gray-5">· {{ renewal.months }} mo</span>
                  </td>
                  <td>
                    <template v-if="renewal.periodStart && renewal.periodEnd">
                      {{ formatDate(renewal.periodStart) }} – {{ formatDate(renewal.periodEnd) }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td>{{ renewal.amount !== null ? formatPrice(renewal.amount) : '—' }}</td>
                  <td>
                    <template v-if="renewal.paymentMethod">
                      {{ paymentMethodLabel(renewal.paymentMethod) }}
                      <div v-if="renewal.reference" class="fs-12 text-gray-5">Ref {{ renewal.reference }}</div>
                    </template>
                    <template v-else>—</template>
                    <div v-if="renewal.confirmedBy" class="fs-12 text-gray-5">by {{ renewal.confirmedBy }}</div>
                  </td>
                  <td>
                    <span class="badge" :class="renewalBadge(renewal.status).class">
                      {{ renewalBadge(renewal.status).label }}
                    </span>
                    <div v-if="renewal.note" class="fs-12 text-gray-5 note" :title="renewal.note">{{ renewal.note }}</div>
                  </td>
                </tr>
                <tr v-if="renewals.length === 0">
                  <td colspan="6" class="text-center text-gray-5 py-4">No renewals or payments yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </template>

  <UsStoreInfoModal
    v-if="editingInfo && store"
    :store="store"
    @close="editingInfo = false"
    @saved="(s) => onStoreSaved(s, 'Store information saved.')"
  />
  <UsSubscriptionModal
    v-if="editingSubscription && store"
    :store="store"
    :plans="plans"
    @close="editingSubscription = false"
    @saved="(s) => onStoreSaved(s, 'Subscription updated.')"
  />
  <UsPaymentModal
    v-if="recordingPayment && store"
    :store="{ id: store.id, name: store.name, planId: store.plan.id }"
    :plans="plans"
    :expires-at="store.expiresAt"
    @close="recordingPayment = false"
    @saved="onPaid"
  />
  <UsPaymentModal
    v-if="confirmingRenewal && store"
    :renewal="confirmingRenewal"
    :expires-at="store.expiresAt"
    @close="confirmingRenewal = null"
    @saved="onPaid"
  />
  <UsResetPasswordModal
    v-if="resetting"
    :store-id="id"
    :user="resetting"
    @close="resetting = null"
    @saved="(notice = `Password reset for ${resetting!.fullName}.`), (resetting = null)"
  />
  <UsConfirmModal
    v-if="confirm"
    :title="confirm.title"
    :message="confirm.message"
    :confirm-label="confirm.confirmLabel"
    :danger="confirm.danger"
    :action="confirm.action"
    @close="confirm = null"
    @done="onConfirmed"
  />
</template>

<style scoped>
.progress {
  height: 8px;
}

.details dt {
  font-size: 12px;
  font-weight: 400;
  color: #a6aaaf;
}

.details dd {
  margin-bottom: 12px;
}

.details dd:last-child {
  margin-bottom: 0;
}

.note {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
