<script setup lang="ts">
// "/" is the public landing page for signed-out visitors and the dashboard for signed-in users
import { useRoute } from 'vue-router'
import { currentUser } from '@/auth'
import LandingView from '@/views/landing/LandingView.vue'
import AppLayout from './AppLayout.vue'

const route = useRoute()
</script>

<template>
  <LandingView v-if="!currentUser && route.name === 'dashboard'" />
  <AppLayout v-else />
</template>
