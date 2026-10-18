<script setup lang="ts">
// The list of reports (/reports), grouped by what they cover.
import { computed } from 'vue'
import { can } from '@/auth'
import { REPORT_GROUPS, REPORTS } from './reports'

const groups = computed(() =>
  REPORT_GROUPS.map((title) => ({
    title,
    reports: REPORTS.filter((r) => r.group === title && (!r.permission || can(r.permission))),
  })).filter((g) => g.reports.length > 0),
)
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Reports</h4>
      <h6>See how the store is doing: sales, money and stock</h6>
    </div>
  </div>

  <section v-for="group in groups" :key="group.title" class="mb-4">
    <h5 class="group-title">{{ group.title }}</h5>
    <div class="row g-3">
      <div v-for="report in group.reports" :key="report.key" class="col-12 col-sm-6 col-xl-4">
        <RouterLink :to="{ name: 'report', params: { reportKey: report.key } }" class="report-card">
          <span class="report-icon"><i class="ti" :class="`ti-${report.icon}`"></i></span>
          <span class="min-w-0">
            <span class="d-block fw-semibold text-gray-9">{{ report.title }}</span>
            <span class="d-block fs-13 text-gray-5">{{ report.description }}</span>
            <span v-if="!report.dated" class="badge bg-light text-gray-7 mt-2">Snapshot as of today</span>
          </span>
          <i class="ti ti-chevron-right text-gray-4 ms-auto flex-shrink-0"></i>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.group-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #646b72;
  margin-bottom: 12px;
}

.report-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  height: 100%;
  padding: 16px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: inherit;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.report-card:hover,
.report-card:focus-visible {
  border-color: #fe9f43;
  box-shadow: 0 4px 16px rgba(254, 159, 67, 0.12);
}

.report-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  background: #fff6ee;
  color: #fe9f43;
  font-size: 21px;
}

.min-w-0 {
  min-width: 0;
}

.badge {
  font-weight: 500;
  font-size: 11px;
}
</style>
