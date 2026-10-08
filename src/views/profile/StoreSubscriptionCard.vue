<script setup lang="ts">
// The admin's store and its subscription, on the Profile page (Admin role only).
import { computed, ref } from 'vue'
import { currentUser } from '@/auth'
import { storeCode } from '@/api/store'
import { daysLeft, describeSeats, formatDate, getSubscription, type Subscription } from '@/api/subscription'

const subscription = ref<Subscription | null>(null)
const loadError = ref('')

getSubscription()
  .then((value) => (subscription.value = value))
  .catch((e) => (loadError.value = e instanceof Error ? e.message : 'Could not load your subscription'))

const remaining = computed(() =>
  subscription.value?.expiresAt && !subscription.value.expired ? daysLeft(subscription.value.expiresAt) : 0,
)

const status = computed(() => {
  if (!subscription.value) return null
  if (subscription.value.expired) return { label: 'Expired', class: 'bg-danger' }
  if (remaining.value <= 7) return { label: 'Expiring soon', class: 'bg-warning' }
  return { label: 'Active', class: 'bg-success' }
})

const number = new Intl.NumberFormat('en-US')
</script>

<template>
  <div class="card">
    <div class="card-header d-flex align-items-center justify-content-between gap-2">
      <h5 class="card-title mb-0">Store &amp; Subscription</h5>
      <RouterLink :to="{ name: 'subscription' }" class="btn btn-sm btn-white border">Manage Subscription</RouterLink>
    </div>
    <div class="card-body">
      <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>

      <div class="row g-3">
        <div class="col-sm-6 col-xl-3">
          <div class="fs-12 text-gray-5">Store code</div>
          <div class="fw-semibold">{{ currentUser ? storeCode(currentUser.store.id) : '' }}</div>
        </div>
        <div class="col-sm-6 col-xl-3">
          <div class="fs-12 text-gray-5">Store name</div>
          <div class="fw-semibold">{{ currentUser?.store.name }}</div>
        </div>

        <template v-if="subscription">
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">Plan</div>
            <div class="fw-semibold">{{ subscription.plan.name }} <span class="fw-normal text-gray-5">· monthly</span></div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">Status</div>
            <span v-if="status" class="badge" :class="status.class">{{ status.label }}</span>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">{{ subscription.expired ? 'Expired on' : 'Expires on' }}</div>
            <div class="fw-semibold">
              {{ subscription.expiresAt ? formatDate(subscription.expiresAt) : '—' }}
              <span v-if="!subscription.expired" class="fw-normal text-gray-5">
                · {{ remaining }} day{{ remaining === 1 ? '' : 's' }} left
              </span>
            </div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">Seats</div>
            <div class="fw-semibold">{{ describeSeats(subscription.plan) }}</div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">Users</div>
            <div class="fw-semibold">{{ subscription.usage.users }} / {{ subscription.plan.maxUsers }}</div>
          </div>
          <div class="col-sm-6 col-xl-3">
            <div class="fs-12 text-gray-5">Products</div>
            <div class="fw-semibold">
              {{ number.format(subscription.usage.products) }} / {{ number.format(subscription.plan.maxProducts) }}
            </div>
          </div>
        </template>
      </div>

      <div v-if="subscription?.pendingRenewal" class="alert alert-info py-2 mt-3 mb-0" role="status">
        <i class="ti ti-hourglass me-1"></i>Renewal on the {{ subscription.pendingRenewal.plan.name }} plan, requested
        {{ formatDate(subscription.pendingRenewal.createdAt) }}, is waiting for payment.
      </div>
    </div>
  </div>
</template>
