<script setup lang="ts">
// Plan prices and limits. Changes apply to every store on the plan right away (prices apply
// from their next payment). Stores already over a lowered limit keep what they have.
import { ref } from 'vue'
import { describeSeats, formatPrice } from '@/api/subscription'
import { listPanelPlans, type PanelPlan } from '@/api/usPanel'
import UsPlanFormModal from './UsPlanFormModal.vue'

const plans = ref<PanelPlan[]>([])
const loading = ref(false)
const loadError = ref('')
const notice = ref('')
const editing = ref<PanelPlan | null>(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    plans.value = await listPanelPlans()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load plans'
  } finally {
    loading.value = false
  }
}
load()

function onSaved(plan: PanelPlan) {
  editing.value = null
  notice.value = `${plan.name} plan saved.`
  load()
}

const number = new Intl.NumberFormat('en-US')
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Plans</h4>
      <h6>Prices and limits of each subscription plan</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button type="button" class="btn btn-white border" title="Refresh" :disabled="loading" @click="load">
        <i class="ti ti-refresh"></i>
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2" role="alert">{{ loadError }}</div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <div class="row g-3" :class="{ 'is-loading': loading }">
    <div v-for="plan in plans" :key="plan.id" class="col-md-6 col-xl-4">
      <div class="card h-100 mb-0">
        <div class="card-body d-flex flex-column">
          <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
            <div>
              <h5 class="mb-1">{{ plan.name }}</h5>
              <div class="fs-12 text-gray-5">id: {{ plan.id }}</div>
            </div>
            <RouterLink :to="{ name: 'us-stores', query: { planId: plan.id } }" class="badge bg-primary-transparent text-primary">
              {{ plan.stores }} store{{ plan.stores === 1 ? '' : 's' }}
            </RouterLink>
          </div>
          <div class="fs-24 fw-bold text-gray-9 mb-3">
            {{ formatPrice(plan.monthlyPrice) }}<span class="fs-14 fw-normal text-gray-5">/month</span>
          </div>
          <ul class="list-unstyled fs-14 mb-3">
            <li class="mb-1"><i class="ti ti-users me-2 text-primary"></i>{{ describeSeats(plan) }}</li>
            <li><i class="ti ti-box me-2 text-primary"></i>Up to {{ number.format(plan.maxProducts) }} products</li>
          </ul>
          <button type="button" class="btn btn-sm btn-outline-primary mt-auto align-self-start" @click="editing = plan">
            <i class="ti ti-edit me-1"></i>Edit Plan
          </button>
        </div>
      </div>
    </div>
  </div>

  <UsPlanFormModal v-if="editing" :plan="editing" @close="editing = null" @saved="onSaved" />
</template>
