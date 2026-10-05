<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentUser, logout } from '@/auth'

const router = useRouter()
const route = useRoute()

// Mobile sidebar toggle (the template's CSS keys off these classes)
const sidebarOpen = ref(false)
watch(sidebarOpen, (open) => document.documentElement.classList.toggle('menu-opened', open))
watch(() => route.fullPath, () => (sidebarOpen.value = false))

async function handleLogout() {
  await logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="main-wrapper" :class="{ 'slide-nav': sidebarOpen }">
    <!-- Header -->
    <div class="header">
      <div class="main-header">
        <div class="header-left active">
          <RouterLink :to="{ name: 'dashboard' }" class="logo logo-normal">
            <img src="/assets/img/logo.svg" alt="uPOS" />
          </RouterLink>
          <RouterLink :to="{ name: 'dashboard' }" class="logo-small">
            <img src="/assets/img/logo-small.png" alt="uPOS" />
          </RouterLink>
        </div>

        <a id="mobile_btn" class="mobile_btn" href="#" @click.prevent="sidebarOpen = !sidebarOpen">
          <span class="bar-icon">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </a>

        <div class="header-user ms-auto d-flex align-items-center gap-3 pe-3">
          <div class="text-end d-none d-sm-block">
            <div class="fw-medium text-gray-9">{{ currentUser?.fullName }}</div>
            <div class="fs-12 text-gray-5 text-capitalize">{{ currentUser?.role }}</div>
          </div>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="handleLogout">
            <i class="ti ti-logout me-1"></i>Logout
          </button>
        </div>
      </div>
    </div>

    <!-- Sidebar -->
    <div id="sidebar" class="sidebar">
      <div class="sidebar-inner">
        <div id="sidebar-menu" class="sidebar-menu">
          <ul>
            <li class="submenu-open">
              <h6 class="submenu-hdr">Main</h6>
              <ul>
                <li :class="{ active: route.name === 'dashboard' }">
                  <RouterLink :to="{ name: 'dashboard' }">
                    <i class="ti ti-layout-grid fs-16 me-2"></i><span>Dashboard</span>
                  </RouterLink>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div class="sidebar-overlay" :class="{ opened: sidebarOpen }" @click="sidebarOpen = false"></div>

    <!-- Page content -->
    <div class="page-wrapper">
      <div class="content">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.header .main-header {
  display: flex;
  align-items: center;
}

.header-user {
  height: 100%;
}
</style>
