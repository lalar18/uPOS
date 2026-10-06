import { createRouter, createWebHistory } from 'vue-router'
import { loadSession } from './auth'
import AppLayout from './layouts/AppLayout.vue'
import BrandView from './views/brand/BrandView.vue'
import CategoryView from './views/category/CategoryView.vue'
import ComingSoonView from './views/common/ComingSoonView.vue'
import DashboardView from './views/dashboard/DashboardView.vue'
import LoginView from './views/auth/LoginView.vue'
import ProductFormView from './views/product/ProductFormView.vue'
import ProductView from './views/product/ProductView.vue'
import ProfileView from './views/profile/ProfileView.vue'
import StoreView from './views/store/StoreView.vue'
import SubCategoryView from './views/subcategory/SubCategoryView.vue'
import UnitView from './views/unit/UnitView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { guestOnly: true } },
    {
      // Pages inside the header + sidebar layout. Add new pages as children here.
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'dashboard', component: DashboardView },
        { path: 'profile', name: 'profile', component: ProfileView },
        { path: 'categories', name: 'categories', component: CategoryView },
        { path: 'sub-categories', name: 'sub-categories', component: SubCategoryView },
        { path: 'brands', name: 'brands', component: BrandView },
        { path: 'units', name: 'units', component: UnitView },
        { path: 'products', name: 'products', component: ProductView },
        { path: 'products/create', name: 'product-create', component: ProductFormView },
        {
          path: 'products/:id(\\d+)/edit',
          name: 'product-edit',
          component: ProductFormView,
          props: true,
          meta: { menu: '/products' }, // highlights "Products" in the sidebar
        },
        { path: 'store', name: 'store', component: StoreView },
        // Sidebar links without a page yet (and unknown URLs) land here
        { path: ':pathMatch(.*)*', name: 'coming-soon', component: ComingSoonView },
      ],
    },
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
