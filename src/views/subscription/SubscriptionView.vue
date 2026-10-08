<script setup lang="ts">
// The store's subscription plan, when it expires, and how much of it is used (Admin role only).
// Plans are billed monthly. Renewing adds a request that the platform owner confirms once
// it's paid (online payment comes later), which extends the store by a month.
import { computed, ref } from 'vue'
import { currentUser } from '@/auth'
import {
  cancelRenewal,
  daysLeft,
  describeSeats,
  formatDate,
  getSubscription,
  requestRenewal,
  type Subscription,
} from '@/api/subscription'

const subscription = ref<Subscription | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const actionError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    subscription.value = await getSubscription()
    // Keeps the banner and read-only mode in step (e.g. after a renewal was confirmed)
    if (currentUser.value) {
      currentUser.value.store.subscription = {
        expiresAt: subscription.value.expiresAt,
        expired: subscription.value.expired,
      }
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load your subscription'
  } finally {
    loading.value = false
  }
}
load()

async function renew(planId: string) {
  saving.value = true
  actionError.value = ''
  try {
    await requestRenewal(planId)
    await load()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Could not request the renewal'
  } finally {
    saving.value = false
  }
}

async function cancelPending() {
  if (!subscription.value?.pendingRenewal) return
  saving.value = true
  actionError.value = ''
  try {
    await cancelRenewal(subscription.value.pendingRenewal.id)
    await load()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Could not cancel the renewal'
  } finally {
    saving.value = false
  }
}

const remaining = computed(() =>
  subscription.value?.expiresAt && !subscription.value.expired ? daysLeft(subscription.value.expiresAt) : 0,
)

const number = new Intl.NumberFormat('en-US')

/** Width of a usage bar, capped at 100% (a store moved to a smaller plan can be over) */
const percent = (used: number, max: number) => `${Math.min(100, Math.round((used / max) * 100))}%`
const barClass = (used: number, max: number) => (used >= max ? 'bg-danger' : used / max >= 0.8 ? 'bg-warning' : 'bg-primary')
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Subscription</h4>
      <h6>Your plan, when it expires, and how much of it you're using</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>

  <template v-if="subscription">
    <!-- Current plan, expiry and usage -->
    <div class="card" :class="{ 'is-loading': loading }">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <div>
            <div class="fs-12 text-gray-5">Current plan</div>
            <h5 class="mb-0">{{ subscription.plan.name }} <span class="fs-13 fw-normal text-gray-5">· monthly</span></h5>
          </div>
          <span class="badge bg-primary-transparent fs-12">{{ describeSeats(subscription.plan) }}</span>
        </div>

        <!-- Expiry -->
        <div
          class="expiry d-flex flex-wrap align-items-center justify-content-between gap-3 rounded p-3 mb-4"
          :class="subscription.expired ? 'bg-danger-transparent' : remaining <= 7 ? 'bg-warning-transparent' : 'bg-light'"
        >
          <div class="d-flex align-items-center gap-2">
            <i
              class="ti fs-24"
              :class="subscription.expired ? 'ti-calendar-x text-danger' : 'ti-calendar-event text-primary'"
            ></i>
            <div>
              <div class="fs-12 text-gray-5">{{ subscription.expired ? 'Expired on' : 'Expires on' }}</div>
              <div class="fw-semibold">
                {{ subscription.expiresAt ? formatDate(subscription.expiresAt) : '—' }}
                <span v-if="!subscription.expired" class="fw-normal text-gray-5">
                  · {{ remaining }} day{{ remaining === 1 ? '' : 's' }} left
                </span>
              </div>
              <div v-if="subscription.expired" class="fs-13 text-danger">
                Your store is view-only until you renew.
              </div>
            </div>
          </div>
          <button
            v-if="!subscription.pendingRenewal"
            type="button"
            class="btn btn-primary"
            :disabled="saving"
            @click="renew(subscription.plan.id)"
          >
            <i class="ti ti-refresh me-1"></i>Renew {{ subscription.plan.name }} for 1 month
          </button>
        </div>

        <div v-if="actionError" class="alert alert-danger py-2" role="alert">{{ actionError }}</div>

        <!-- Waiting for payment -->
        <div
          v-if="subscription.pendingRenewal"
          class="alert alert-info d-flex flex-wrap align-items-start justify-content-between gap-2"
          role="status"
        >
          <div>
            <div class="fw-semibold">
              <i class="ti ti-hourglass me-1"></i>Renewal on the {{ subscription.pendingRenewal.plan.name }} plan is
              waiting for payment
            </div>
            <div class="fs-13">
              Requested {{ formatDate(subscription.pendingRenewal.createdAt) }}
              <template v-if="subscription.pendingRenewal.requestedBy">
                by {{ subscription.pendingRenewal.requestedBy }}</template
              >. Once your system provider confirms the payment, your subscription is extended by one month.
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-white border" :disabled="saving" @click="cancelPending">
            Cancel request
          </button>
        </div>

        <div class="row g-4">
          <div class="col-md-6">
            <div class="d-flex justify-content-between fs-14 mb-1">
              <span>Users</span>
              <span class="fw-medium">{{ subscription.usage.users }} / {{ subscription.plan.maxUsers }}</span>
            </div>
            <div class="progress" role="progressbar" aria-label="Users used">
              <div
                class="progress-bar"
                :class="barClass(subscription.usage.users, subscription.plan.maxUsers)"
                :style="{ width: percent(subscription.usage.users, subscription.plan.maxUsers) }"
              ></div>
            </div>
            <div class="fs-12 text-gray-5 mt-1">
              {{ subscription.usage.admins }} admin{{ subscription.usage.admins === 1 ? '' : 's' }}
              <template v-if="subscription.plan.maxAdmins !== null">of {{ subscription.plan.maxAdmins }} allowed</template>
              · inactive users count too
            </div>
          </div>
          <div class="col-md-6">
            <div class="d-flex justify-content-between fs-14 mb-1">
              <span>Products</span>
              <span class="fw-medium">
                {{ number.format(subscription.usage.products) }} / {{ number.format(subscription.plan.maxProducts) }}
              </span>
            </div>
            <div class="progress" role="progressbar" aria-label="Products used">
              <div
                class="progress-bar"
                :class="barClass(subscription.usage.products, subscription.plan.maxProducts)"
                :style="{ width: percent(subscription.usage.products, subscription.plan.maxProducts) }"
              ></div>
            </div>
            <div class="fs-12 text-gray-5 mt-1">Inactive products count too</div>
          </div>
        </div>
      </div>
    </div>

    <!-- All plans -->
    <h5 class="mb-3">Plans</h5>
    <div class="row g-3">
      <div v-for="plan in subscription.plans" :key="plan.id" class="col-md-4">
        <div class="card h-100 mb-0" :class="{ 'border-primary current-plan': plan.id === subscription.plan.id }">
          <div class="card-body d-flex flex-column">
            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
              <h6 class="mb-0">{{ plan.name }}</h6>
              <span v-if="plan.id === subscription.plan.id" class="badge bg-primary">Current</span>
            </div>
            <ul class="list-unstyled mb-3 fs-14">
              <li class="mb-1"><i class="ti ti-users me-2 text-primary"></i>{{ describeSeats(plan) }}</li>
              <li><i class="ti ti-box me-2 text-primary"></i>Up to {{ number.format(plan.maxProducts) }} products</li>
            </ul>
            <button
              v-if="plan.id !== subscription.plan.id && !subscription.pendingRenewal"
              type="button"
              class="btn btn-sm btn-outline-primary mt-auto align-self-start"
              :disabled="saving"
              @click="renew(plan.id)"
            >
              Renew on {{ plan.name }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <p class="fs-13 text-gray-5 mt-3">
      A renewal on another plan switches to it as soon as it's paid. Payment is confirmed by your system provider.
    </p>

    <!-- Paid renewals -->
    <template v-if="subscription.renewals.length">
      <h5 class="mb-3 mt-4">Renewal history</h5>
      <div class="card">
        <div class="table-responsive">
          <table class="table mb-0">
            <thead class="thead-light">
              <tr>
                <th>Plan</th>
                <th>Period</th>
                <th>Paid on</th>
                <th>Requested by</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="renewal in subscription.renewals" :key="renewal.id">
                <td>{{ renewal.plan.name }}</td>
                <td>
                  <template v-if="renewal.periodStart && renewal.periodEnd">
                    {{ formatDate(renewal.periodStart) }} – {{ formatDate(renewal.periodEnd) }}
                  </template>
                </td>
                <td>{{ renewal.paidAt ? formatDate(renewal.paidAt) : '' }}</td>
                <td>{{ renewal.requestedBy ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </template>
</template>

<style scoped>
.progress {
  height: 8px;
}

.current-plan {
  border-width: 2px;
}

.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}
</style>
