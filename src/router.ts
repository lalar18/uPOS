import { createRouter, createWebHistory } from 'vue-router'
import { loadSession } from './auth'
import AppLayout from './layouts/AppLayout.vue'
import DashboardView from './views/DashboardView.vue'
import LoginView from './views/LoginView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
    {
      // Pages inside the header + sidebar layout. Add new pages as children here.
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [{ path: '', name: 'dashboard', component: DashboardView }],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const user = await loadSession()

  if (to.matched.some((r) => r.meta.requiresAuth) && !user) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (to.meta.guestOnly && user) {
    return { name: 'dashboard' }
  }
})

export default router
