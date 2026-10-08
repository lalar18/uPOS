<script setup lang="ts">
// Home page: the widgets the user picked (or their role's default set). Customize adds,
// removes and reorders them, unless an admin has locked this user's dashboard.
import { computed, ref } from 'vue'
import { getLayout, saveLayout, type DashboardLayout } from '@/api/dashboard'
import { currentUser } from '@/auth'
import DashboardLayoutModal from './DashboardLayoutModal.vue'
import { widgetsFor } from './widgets'

const layout = ref<DashboardLayout | null>(null)
const loading = ref(true)
const loadError = ref('')
const notice = ref('')
const customizing = ref(false)
const refreshKey = ref(0) // bumping it remounts every widget, which reloads them

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    layout.value = await getLayout()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load your dashboard'
  } finally {
    loading.value = false
  }
}
load()

const widgets = computed(() => widgetsFor(layout.value?.widgets ?? []))

const todayText = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date())

function onSaved(saved: DashboardLayout) {
  layout.value = saved
  customizing.value = false
  notice.value = 'Dashboard saved.'
}
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>Welcome back, {{ currentUser?.fullName }}</h4>
      <h6>{{ todayText }}</h6>
    </div>
    <div class="page-actions d-flex align-items-center gap-2">
      <button
        type="button"
        class="btn btn-white border"
        title="Refresh"
        aria-label="Refresh"
        :disabled="loading"
        @click="refreshKey++"
      >
        <i class="ti ti-refresh"></i>
      </button>
      <span v-if="layout?.locked" class="badge bg-light text-dark d-inline-flex align-items-center py-2 px-3">
        <i class="ti ti-lock me-1"></i>Set by your admin
      </span>
      <button
        v-else
        type="button"
        class="btn btn-primary"
        :disabled="!layout"
        @click="(notice = ''), (customizing = true)"
      >
        <i class="ti ti-adjustments-horizontal me-1"></i>Customize
      </button>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between gap-2" role="alert">
    {{ loadError }}
    <button type="button" class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
  </div>
  <div v-if="notice" class="alert alert-success py-2 d-flex align-items-center justify-content-between gap-2" role="status">
    {{ notice }}
    <button type="button" class="btn btn-sm btn-link text-success p-0" @click="notice = ''">Dismiss</button>
  </div>

  <div v-if="layout && widgets.length === 0" class="card">
    <div class="card-body text-center py-5">
      <i class="ti ti-layout-dashboard fs-24 d-block mb-2 text-gray-5"></i>
      <div class="text-gray-9 fw-medium mb-1">Your dashboard is empty</div>
      <template v-if="layout.locked">
        <div class="text-gray-5 fs-14">Your admin hasn't added any widgets for you.</div>
      </template>
      <template v-else>
        <div class="text-gray-5 fs-14 mb-3">Add the widgets you want to see here.</div>
        <button type="button" class="btn btn-primary" @click="customizing = true">
          <i class="ti ti-plus me-1"></i>Add Widgets
        </button>
      </template>
    </div>
  </div>

  <div v-else class="row g-3">
    <div v-for="widget in widgets" :key="`${widget.key}-${refreshKey}`" :class="widget.size">
      <component :is="widget.component" />
    </div>
  </div>

  <DashboardLayoutModal
    v-if="customizing"
    title="Customize Dashboard"
    :load="getLayout"
    :save="(widgets) => saveLayout(widgets)"
    @close="customizing = false"
    @saved="onSaved"
  />
</template>

<style scoped>
@media (max-width: 575.98px) {
  .page-actions {
    width: 100%;
  }

  .page-actions .btn-primary,
  .page-actions .badge {
    flex: 1;
    justify-content: center;
  }
}
</style>
