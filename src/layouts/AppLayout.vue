<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentUser, logout } from '@/auth'
import UserAvatar from '@/components/UserAvatar.vue'
import { menu, type MenuItem } from './menu'

const router = useRouter()
const route = useRoute()

const isAdmin = computed(() => currentUser.value?.role === 'admin')
const visibleMenu = computed(() =>
  menu
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.adminOnly || isAdmin.value) }))
    .filter((section) => section.items.length > 0),
)

function isActive(item: MenuItem) {
  return route.path === item.to
}

// --- Sidebar state (the template's CSS keys off these classes) ---

const COLLAPSED_KEY = 'sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const sidebarOpen = ref(false) // mobile slide-in
const collapsed = ref(readCollapsed()) // desktop mini sidebar
const hovering = ref(false) // a collapsed sidebar expands while hovered

watch(collapsed, (value) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Storage unavailable (private mode); the setting just won't persist
  }
})

watchEffect(() => {
  document.body.classList.toggle('mini-sidebar', collapsed.value)
  document.body.classList.toggle('expand-menu', collapsed.value && hovering.value)
  document.documentElement.classList.toggle('menu-opened', sidebarOpen.value)
})

// --- Header dropdowns ---

type DropdownName = 'add' | 'profile' | 'mobile'
const openDropdown = ref<DropdownName | null>(null)

function toggleDropdown(name: DropdownName) {
  openDropdown.value = openDropdown.value === name ? null : name
}

function closeDropdownOnOutsideClick(event: MouseEvent) {
  if (!(event.target as Element).closest('[data-dropdown]')) openDropdown.value = null
}

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
    openDropdown.value = null
  },
)

// --- Page search (jumps to a sidebar page) ---

const searchInput = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
const searchFocused = ref(false)
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return []
  return visibleMenu.value
    .flatMap((section) => section.items)
    .filter((item) => item.label.toLowerCase().includes(query))
    .slice(0, 8)
})

function goToResult(item: MenuItem | undefined) {
  if (!item) return
  searchQuery.value = ''
  searchInput.value?.blur()
  router.push(item.to)
}

function focusSearchOnShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchInput.value?.focus()
  }
}

// --- Fullscreen ---

const isFullscreen = ref(false)

function syncFullscreen() {
  isFullscreen.value = document.fullscreenElement !== null
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen()
}

onMounted(() => {
  document.addEventListener('click', closeDropdownOnOutsideClick)
  document.addEventListener('keydown', focusSearchOnShortcut)
  document.addEventListener('fullscreenchange', syncFullscreen)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeDropdownOnOutsideClick)
  document.removeEventListener('keydown', focusSearchOnShortcut)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  document.body.classList.remove('mini-sidebar', 'expand-menu')
  document.documentElement.classList.remove('menu-opened')
})

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
        <!-- Logo (mobile only; on desktop the logo sits in the sidebar) -->
        <div class="header-left active">
          <RouterLink to="/" class="logo logo-normal">
            <img src="/assets/img/logo.svg" alt="uPOS" />
          </RouterLink>
          <RouterLink to="/" class="logo-small">
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

        <ul class="nav user-menu">
          <!-- Search -->
          <li class="nav-item nav-searchinputs">
            <div class="top-nav-search">
              <div class="dropdown">
                <div class="searchinputs input-group">
                  <input
                    ref="searchInput"
                    v-model="searchQuery"
                    type="text"
                    placeholder="Search"
                    @focus="searchFocused = true"
                    @blur="searchFocused = false"
                    @keydown.enter="goToResult(searchResults[0])"
                    @keydown.esc="searchInput?.blur()"
                  />
                  <div class="search-addon">
                    <span><i class="ti ti-search"></i></span>
                  </div>
                  <span class="input-group-text">
                    <kbd class="d-flex align-items-center">
                      <i v-if="isMac" class="ti ti-command me-1"></i><template v-else>Ctrl&nbsp;</template>K
                    </kbd>
                  </span>
                </div>
                <div
                  v-if="searchFocused && searchQuery.trim()"
                  class="dropdown-menu search-results show"
                  data-bs-popper="static"
                >
                  <a
                    v-for="item in searchResults"
                    :key="item.to"
                    href="#"
                    class="dropdown-item d-flex align-items-center"
                    @mousedown.prevent="goToResult(item)"
                  >
                    <i class="ti me-2" :class="`ti-${item.icon}`"></i>{{ item.label }}
                  </a>
                  <span v-if="searchResults.length === 0" class="dropdown-item-text text-gray-5">No matches</span>
                </div>
              </div>
            </div>
          </li>

          <!-- Add New -->
          <li class="nav-item dropdown link-nav" data-dropdown>
            <a
              href="#"
              class="btn btn-primary btn-md d-inline-flex align-items-center"
              @click.prevent="toggleDropdown('add')"
            >
              <i class="ti ti-circle-plus me-1"></i>Add New
            </a>
            <div
              class="dropdown-menu dropdown-menu-end p-2"
              :class="{ show: openDropdown === 'add' }"
              data-bs-popper="static"
            >
              <RouterLink to="/products/create" class="dropdown-item"><i class="ti ti-box me-2"></i>Product</RouterLink>
              <RouterLink to="/categories" class="dropdown-item"><i class="ti ti-list-details me-2"></i>Category</RouterLink>
              <RouterLink to="/quotations" class="dropdown-item">
                <i class="ti ti-file-description me-2"></i>Quotation
              </RouterLink>
              <RouterLink to="/customers" class="dropdown-item"><i class="ti ti-users-group me-2"></i>Customer</RouterLink>
              <RouterLink to="/suppliers" class="dropdown-item"><i class="ti ti-user-dollar me-2"></i>Supplier</RouterLink>
            </div>
          </li>

          <!-- POS -->
          <li class="nav-item pos-nav">
            <RouterLink to="/pos" class="btn btn-dark btn-md d-inline-flex align-items-center">
              <i class="ti ti-device-laptop me-1"></i>POS
            </RouterLink>
          </li>

          <!-- Fullscreen -->
          <li class="nav-item nav-item-box">
            <a href="#" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click.prevent="toggleFullscreen">
              <i class="ti" :class="isFullscreen ? 'ti-minimize' : 'ti-maximize'"></i>
            </a>
          </li>

          <!-- Settings -->
          <li v-if="isAdmin" class="nav-item nav-item-box">
            <RouterLink to="/settings" title="Settings"><i class="ti ti-settings"></i></RouterLink>
          </li>

          <!-- Profile -->
          <li class="nav-item dropdown has-arrow main-drop profile-nav" data-dropdown>
            <a href="#" class="nav-link userset" @click.prevent="toggleDropdown('profile')">
              <span class="user-info p-0">
                <UserAvatar :user="currentUser" :size="32" />
              </span>
            </a>
            <div
              class="dropdown-menu dropdown-menu-end menu-drop-user"
              :class="{ show: openDropdown === 'profile' }"
              data-bs-popper="static"
            >
              <div class="profileset d-flex align-items-center">
                <UserAvatar :user="currentUser" :size="40" class="me-2" />
                <div>
                  <h6 class="fw-medium">{{ currentUser?.fullName }}</h6>
                  <p class="mb-0"><span class="text-capitalize">{{ currentUser?.role }}</span> · {{ currentUser?.store.name }}</p>
                </div>
              </div>
              <RouterLink :to="{ name: 'profile' }" class="dropdown-item">
                <i class="ti ti-user-circle me-2"></i>My Profile
              </RouterLink>
              <hr class="my-2" />
              <a href="#" class="dropdown-item logout pb-0" @click.prevent="handleLogout">
                <i class="ti ti-logout me-2"></i>Logout
              </a>
            </div>
          </li>
        </ul>

        <!-- Mobile user menu (replaces the right-hand menu on small screens) -->
        <div class="dropdown mobile-user-menu" data-dropdown>
          <a href="#" class="nav-link dropdown-toggle" @click.prevent="toggleDropdown('mobile')">
            <i class="ti ti-dots-vertical"></i>
          </a>
          <div
            class="dropdown-menu dropdown-menu-end"
            :class="{ show: openDropdown === 'mobile' }"
            data-bs-popper="static"
          >
            <span class="dropdown-item-text fw-medium">{{ currentUser?.fullName }}</span>
            <RouterLink :to="{ name: 'profile' }" class="dropdown-item">My Profile</RouterLink>
            <a href="#" class="dropdown-item" @click.prevent="handleLogout">Logout</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Sidebar -->
    <div id="sidebar" class="sidebar" @mouseenter="hovering = true" @mouseleave="hovering = false">
      <div class="sidebar-logo">
        <RouterLink to="/" class="logo logo-normal">
          <img src="/assets/img/logo.svg" alt="uPOS" />
        </RouterLink>
        <RouterLink to="/" class="logo-small">
          <img src="/assets/img/logo-small.png" alt="uPOS" />
        </RouterLink>
        <a
          id="toggle_btn"
          href="#"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click.prevent="collapsed = !collapsed"
        >
          <i class="ti" :class="collapsed ? 'ti-chevrons-right' : 'ti-chevrons-left'"></i>
        </a>
      </div>

      <div class="sidebar-inner">
        <div id="sidebar-menu" class="sidebar-menu">
          <ul>
            <li v-for="section in visibleMenu" :key="section.title" class="submenu-open">
              <h6 class="submenu-hdr">{{ section.title }}</h6>
              <ul>
                <li v-for="item in section.items" :key="item.to" :class="{ active: isActive(item) }">
                  <RouterLink :to="item.to" :title="item.label">
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

    <!-- Page content -->
    <div class="page-wrapper">
      <div class="content">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The template scrolls the menu with a jQuery plugin; plain overflow does the same job */
.sidebar-inner {
  height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
}

@media (min-width: 992px) {
  .sidebar-inner {
    height: calc(100% - 65px); /* minus .sidebar-logo */
  }
}

.search-results {
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
}

/*
 * The template's CSS shifts header dropdowns 100px down and relies on Popper.js to
 * reposition them. We open them with Vue instead, so place them directly under the
 * trigger and keep a short fade/slide in place of the template's animation.
 */
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
