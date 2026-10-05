<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { menu } from '@/layouts/menu'

const route = useRoute()

const title = computed(
  () => menu.flatMap((s) => s.items).find((item) => item.to === route.path)?.label ?? 'Page not found',
)
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>{{ title }}</h4>
      <h6>This page hasn't been built yet</h6>
    </div>
  </div>

  <div class="card">
    <div class="card-body text-center text-gray-5 py-5">
      <i class="ti ti-tools fs-24 d-block mb-2"></i>
      Coming soon.
    </div>
  </div>
</template>
