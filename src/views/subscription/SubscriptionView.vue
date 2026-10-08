<script setup lang="ts">
// The store's subscription plan and how much of it is used (Admin role only).
// Plans are changed by the platform owner, so this page is read-only.
import { ref } from 'vue'
import { describeSeats, getSubscription, type Subscription } from '@/api/subscription'

const subscription = ref<Subscription | null>(null)
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    subscription.value = await getSubscription()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load your subscription'
  } finally {
    loading.value = false
  }
}
load()

const number = new Intl.NumberFormat('en-US')

/** Width of a usage bar, capped at 100% (a store moved to a smaller plan can be over) */
const percent = (used: number, max: number) => `${Math.min(100, Math.round((used / max) * 100))}%`
const barClass = (used: number, max: number) => (used >= max ? 'bg-danger' : used / max >= 0.8 ? 'bg-warning' : 'bg-primary')
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Subscription</h4>
      <h6>Your plan and how much of it you're using</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>

  <template v-if="subscription">
    <!-- Current plan and usage -->
    <div class="card" :class="{ 'is-loading': loading }">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <div>
            <div class="fs-12 text-gray-5">Current plan</div>
            <h5 class="mb-0">{{ subscription.plan.name }}</h5>
          </div>
          <span class="badge bg-primary-transparent fs-12">{{ describeSeats(subscription.plan) }}</span>
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
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
              <h6 class="mb-0">{{ plan.name }}</h6>
              <span v-if="plan.id === subscription.plan.id" class="badge bg-primary">Current</span>
            </div>
            <ul class="list-unstyled mb-0 fs-14">
              <li class="mb-1"><i class="ti ti-users me-2 text-primary"></i>{{ describeSeats(plan) }}</li>
              <li><i class="ti ti-box me-2 text-primary"></i>Up to {{ number.format(plan.maxProducts) }} products</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <p class="fs-13 text-gray-5 mt-3 mb-0">To change your plan, contact your system provider.</p>
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
