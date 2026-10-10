<script setup lang="ts">
// Header + sidebar for the US Panel (super admins). Uses the template's classes like
// AppLayout, but has its own short menu and no store-specific parts.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentSuperAdmin, logoutSuperAdmin } from '@/usPanelAuth'

const router = useRouter()
const route = useRoute()

const menu = [
  { label: 'Dashboard', to: '/us-panel', icon: 'layout-grid' },
  { label: 'Stores', to: '/us-panel/stores', icon: 'building-store' },
  { label: 'Billing', to: '/us-panel/billing', icon: 'receipt-2' },
  { label: 'Income', to: '/us-panel/income', icon: 'cash' },
  { label: 'Plans', to: '/us-panel/plans', icon: 'crown' },
  { label: 'Account', to: '/us-panel/account', icon: 'user-shield' },
]

const isActive = (to: string) => route.path === to || route.meta.menu === to

const sidebarOpen = ref(false) // mobile slide-in
const profileOpen = ref(false)

watch(sidebarOpen, (open) => document.documentElement.classList.toggle('menu-opened', open))
watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
    profileOpen.value = false
  },
)

function closeOnOutsideClick(event: MouseEvent) {
  if (!(event.target as Element).closest('[data-dropdown]')) profileOpen.value = false
}

onMounted(() => document.addEventListener('click', closeOnOutsideClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutsideClick)
  document.documentElement.classList.remove('menu-opened')
})

async function handleLogout() {
  await logoutSuperAdmin()
  router.replace({ name: 'us-login' })
}
</script>

<template>
  <div class="main-wrapper us-panel" :class="{ 'slide-nav': sidebarOpen }">
    <!-- Header -->
    <div class="header">
      <div class="main-header">
        <div class="header-left active">
          <RouterLink to="/us-panel" class="logo logo-normal">
            <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
          </RouterLink>
          <RouterLink to="/us-panel" class="logo-small">
            <img src="/assets/img/usystems-pos-favicon.svg" alt="USystems POS" />
          </RouterLink>
        </div>

        <a id="mobile_btn" class="mobile_btn" href="#" @click.prevent="sidebarOpen = !sidebarOpen">
          <span class="bar-icon">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </a>

        <ul class="nav user-menu">
          <li class="nav-item me-auto d-none d-lg-flex align-items-center">
            <span class="badge bg-dark fs-12"><i class="ti ti-shield-lock me-1"></i>US Panel</span>
          </li>
          <li class="nav-item dropdown has-arrow main-drop profile-nav" data-dropdown>
            <a href="#" class="nav-link userset" @click.prevent="profileOpen = !profileOpen">
              <span class="avatar-initial">{{ currentSuperAdmin?.fullName.charAt(0).toUpperCase() }}</span>
            </a>
            <div
              class="dropdown-menu dropdown-menu-end menu-drop-user"
              :class="{ show: profileOpen }"
              data-bs-popper="static"
            >
              <div class="profileset">
                <h6 class="fw-medium">{{ currentSuperAdmin?.fullName }}</h6>
                <p class="mb-0 text-break">Super admin · {{ currentSuperAdmin?.email }}</p>
              </div>
              <RouterLink :to="{ name: 'us-account' }" class="dropdown-item">
                <i class="ti ti-user-shield me-2"></i>Account
              </RouterLink>
              <hr class="my-2" />
              <a href="#" class="dropdown-item logout pb-0" @click.prevent="handleLogout">
                <i class="ti ti-logout me-2"></i>Logout
              </a>
            </div>
          </li>
        </ul>

        <!-- Mobile user menu -->
        <div class="dropdown mobile-user-menu" data-dropdown>
          <a href="#" class="nav-link dropdown-toggle" @click.prevent="profileOpen = !profileOpen">
            <i class="ti ti-dots-vertical"></i>
          </a>
          <div class="dropdown-menu dropdown-menu-end" :class="{ show: profileOpen }" data-bs-popper="static">
            <span class="dropdown-item-text fw-medium">{{ currentSuperAdmin?.fullName }}</span>
            <RouterLink :to="{ name: 'us-account' }" class="dropdown-item">Account</RouterLink>
            <a href="#" class="dropdown-item" @click.prevent="handleLogout">Logout</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Sidebar -->
    <div id="sidebar" class="sidebar">
      <div class="sidebar-logo">
        <RouterLink to="/us-panel" class="logo logo-normal">
          <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
        </RouterLink>
        <RouterLink to="/us-panel" class="logo-small">
          <img src="/assets/img/usystems-pos-favicon.svg" alt="USystems POS" />
        </RouterLink>
      </div>
      <div class="sidebar-inner">
        <div id="sidebar-menu" class="sidebar-menu">
          <ul>
            <li class="submenu-open">
              <h6 class="submenu-hdr">US Panel</h6>
              <ul>
                <li v-for="item in menu" :key="item.to" :class="{ active: isActive(item.to) }">
                  <RouterLink :to="item.to">
                    <i class="ti fs-16 me-2" :class="`ti-${item.icon}`"></i><span>{{ item.label }}</span>
                  </RouterLink>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div class="sidebar-overlay" :class="{ opened: sidebarOpen }" @click="sidebarOpen = false"></div>

    <div class="page-wrapper">
      <div class="content">
        <RouterView :key="route.path" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-inner {
  height: 100%;
  overflow-y: auto;
}

@media (min-width: 992px) {
  .sidebar-inner {
    height: calc(100% - 65px); /* minus .sidebar-logo */
  }
}

.avatar-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #212b36;
  color: #ffffff;
  font-weight: 600;
}

/* Same as AppLayout: dropdowns are opened by Vue, not Popper.js */
.header .dropdown-menu {
  display: block;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    visibility 0.15s;
  margin-top: 8px !important;
}

.header .dropdown-menu.show {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
</style>

<style>
/* Shared by the US Panel pages */
.us-panel .table td,
.us-panel .table th {
  vertical-align: middle;
  white-space: nowrap;
}

.us-panel .badge {
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  font-size: 11px;
}

.us-panel .row-actions {
  display: inline-flex;
  gap: 8px;
}

.us-panel .row-actions button,
.us-panel .row-actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  background: #ffffff;
  color: #212b36;
}

.us-panel .row-actions button:hover,
.us-panel .row-actions a:hover {
  background: #e6eaed;
}

.us-panel .search-input .search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: #a6aaaf;
  pointer-events: none;
}

.us-panel .search-input input {
  padding-left: 32px;
  min-width: 260px;
}

.us-panel .filters .form-select {
  width: auto;
  min-width: 140px;
}

.us-panel .is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

.us-panel .min-w-0 {
  min-width: 0;
}

@media (max-width: 575.98px) {
  .us-panel .search-set,
  .us-panel .search-input,
  .us-panel .search-input input,
  .us-panel .filters {
    width: 100%;
    min-width: 0;
  }

  .us-panel .filters .form-select {
    flex: 1;
    min-width: 0;
  }
}
</style>
