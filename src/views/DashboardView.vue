<script setup lang="ts">
import { currentUser } from '@/auth'
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>Dashboard</h4>
      <h6>Welcome back, {{ currentUser?.fullName }}</h6>
    </div>
  </div>

  <div class="card">
    <div class="card-body text-center text-gray-5 py-5">Nothing here yet.</div>
  </div>
</template>
