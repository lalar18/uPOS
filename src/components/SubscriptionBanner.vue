<script setup lang="ts">
// Shown above every page once the store's subscription is about to run out or has expired.
import { computed, ref } from 'vue'
import { currentUser, isAdmin, subscriptionExpired } from '@/auth'
import { daysLeft, formatDate } from '@/api/subscription'

const WARN_DAYS = 7

const expiresAt = computed(() => currentUser.value?.store.subscription.expiresAt ?? null)
const remaining = computed(() => (expiresAt.value ? daysLeft(expiresAt.value) : 0))
const dismissed = ref(false) // the "expiring soon" warning can be hidden until the next page load

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`
</script>

<template>
  <div v-if="subscriptionExpired()" class="alert alert-danger d-flex align-items-start gap-2" role="alert">
    <i class="ti ti-alert-octagon fs-18 mt-1"></i>
    <div class="flex-grow-1">
      <div class="fw-semibold">
        Your subscription {{ expiresAt ? `expired on ${formatDate(expiresAt)}` : 'has expired' }}
      </div>
      <div class="fs-13">
        You can still view your data, but sales and other changes can't be saved until it's renewed.
        <template v-if="!isAdmin()">Ask your store admin to renew it.</template>
      </div>
    </div>
    <RouterLink v-if="isAdmin()" :to="{ name: 'subscription' }" class="btn btn-sm btn-danger text-nowrap">
      Renew now
    </RouterLink>
  </div>

  <div
    v-else-if="expiresAt && remaining <= WARN_DAYS && !dismissed"
    class="alert alert-warning d-flex align-items-start gap-2"
    role="alert"
  >
    <i class="ti ti-clock-exclamation fs-18 mt-1"></i>
    <div class="flex-grow-1">
      <div class="fw-semibold">Your subscription expires in {{ plural(remaining) }} ({{ formatDate(expiresAt) }})</div>
      <div class="fs-13">
        After that the store becomes view-only.
        {{ isAdmin() ? 'Renew it to keep making sales.' : 'Ask your store admin to renew it.' }}
      </div>
    </div>
    <RouterLink v-if="isAdmin()" :to="{ name: 'subscription' }" class="btn btn-sm btn-warning text-nowrap">
      Renew
    </RouterLink>
    <button type="button" class="btn-close" aria-label="Dismiss" @click="dismissed = true"></button>
  </div>
</template>
