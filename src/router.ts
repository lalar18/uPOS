import { createRouter, createWebHistory } from 'vue-router'
import type { Permission } from './api/roles'
import { loadSession, subscriptionExpired } from './auth'
import AppLayout from './layouts/AppLayout.vue'
import BrandView from './views/brand/BrandView.vue'
import CategoryView from './views/category/CategoryView.vue'
import ComingSoonView from './views/common/ComingSoonView.vue'
import CustomerView from './views/customer/CustomerView.vue'
import DashboardView from './views/dashboard/DashboardView.vue'
import GeneralSettingsView from './views/settings/GeneralSettingsView.vue'
import ExpiredProductsView from './views/product/ExpiredProductsView.vue'
import LabelPrintView from './views/label/LabelPrintView.vue'
import LandingView from './views/landing/LandingView.vue'
import LoginView from './views/auth/LoginView.vue'
import LowStocksView from './views/product/LowStocksView.vue'
import ManageStockView from './views/stock/ManageStockView.vue'
import ProductFormView from './views/product/ProductFormView.vue'
import ProductView from './views/product/ProductView.vue'
import PosView from './views/pos/PosView.vue'
import ProfileView from './views/profile/ProfileView.vue'
import RoleView from './views/role/RoleView.vue'
import QuotationDetailView from './views/quotation/QuotationDetailView.vue'
import QuotationFormView from './views/quotation/QuotationFormView.vue'
import QuotationsView from './views/quotation/QuotationsView.vue'
import SaleDetailView from './views/sales/SaleDetailView.vue'
import SaleFormView from './views/sales/SaleFormView.vue'
import SaleListView from './views/sales/SaleListView.vue'
import SalesReturnsView from './views/salesReturn/SalesReturnsView.vue'
import StockAdjustmentView from './views/stock/StockAdjustmentView.vue'
import StoreView from './views/store/StoreView.vue'
import SubCategoryView from './views/subcategory/SubCategoryView.vue'
import SubscriptionView from './views/subscription/SubscriptionView.vue'
import SupplierView from './views/supplier/SupplierView.vue'
import UnitView from './views/unit/UnitView.vue'
import UserView from './views/user/UserView.vue'
import VariantAttributeView from './views/variant/VariantAttributeView.vue'
import WarrantyView from './views/warranty/WarrantyView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Public site (with pricing); signed-out visitors to "/" land here. Its Portal button opens the login.
    { path: '/welcome', name: 'landing', component: LandingView },
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
        {
          path: 'products/create',
          name: 'product-create',
          component: ProductFormView,
          meta: { permission: 'products.manage', writes: true },
        },
        { path: 'products/expired', name: 'products-expired', component: ExpiredProductsView },
        { path: 'products/low-stocks', name: 'products-low-stocks', component: LowStocksView },
        {
          path: 'products/:id(\\d+)/edit',
          name: 'product-edit',
          component: ProductFormView,
          props: true,
          meta: { menu: '/products', permission: 'products.manage', writes: true }, // menu highlights "Products" in the sidebar
        },
        { path: 'variant-attributes', name: 'variant-attributes', component: VariantAttributeView },
        { path: 'warranties', name: 'warranties', component: WarrantyView },
        { path: 'print-barcode', name: 'print-barcode', component: LabelPrintView, props: { kind: 'barcode' } },
        { path: 'print-qrcode', name: 'print-qrcode', component: LabelPrintView, props: { kind: 'qrcode' } },
        { path: 'stock', name: 'stock', component: ManageStockView },
        { path: 'stock/adjustments', name: 'stock-adjustments', component: StockAdjustmentView },
        { path: 'sales', name: 'sales', component: SaleListView, props: { mode: 'sales' } },
        {
          path: 'sales/create',
          name: 'sale-create',
          component: SaleFormView,
          meta: { menu: '/sales', permission: 'sales.create', writes: true },
        },
        {
          path: 'sales/:id(\\d+)',
          name: 'sale-detail',
          component: SaleDetailView,
          props: true,
          meta: { menu: '/sales' },
        },
        { path: 'sales/returns', name: 'sales-returns', component: SalesReturnsView },
        { path: 'invoices', name: 'invoices', component: SaleListView, props: { mode: 'invoices' } },
        {
          path: 'invoices/:id(\\d+)',
          name: 'invoice-detail',
          component: SaleDetailView,
          props: true,
          meta: { menu: '/invoices' },
        },
        { path: 'quotations', name: 'quotations', component: QuotationsView },
        {
          path: 'quotations/create',
          name: 'quotation-create',
          component: QuotationFormView,
          meta: { menu: '/quotations', permission: 'quotations.manage', writes: true },
        },
        {
          path: 'quotations/:id(\\d+)',
          name: 'quotation-detail',
          component: QuotationDetailView,
          props: true,
          meta: { menu: '/quotations' },
        },
        {
          path: 'quotations/:id(\\d+)/edit',
          name: 'quotation-edit',
          component: QuotationFormView,
          props: true,
          meta: { menu: '/quotations', permission: 'quotations.manage', writes: true },
        },
        { path: 'pos', name: 'pos', component: PosView, meta: { permission: 'sales.create', writes: true } },
        { path: 'customers', name: 'customers', component: CustomerView },
        { path: 'suppliers', name: 'suppliers', component: SupplierView },
        { path: 'store', name: 'store', component: StoreView },
        { path: 'users', name: 'users', component: UserView, meta: { adminOnly: true } },
        { path: 'roles', name: 'roles', component: RoleView, meta: { adminOnly: true } },
        { path: 'subscription', name: 'subscription', component: SubscriptionView, meta: { adminOnly: true } },
        {
          path: 'settings',
          name: 'settings',
          component: GeneralSettingsView,
          meta: { permission: 'settings.manage' },
        },
        // Sidebar links without a page yet (and unknown URLs) land here
        { path: ':pathMatch(.*)*', name: 'coming-soon', component: ComingSoonView },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const user = await loadSession()

  if (to.matched.some((r) => r.meta.requiresAuth) && !user) {
    if (to.fullPath === '/') return { name: 'landing' }
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (to.meta.guestOnly && user) {
    return { name: 'dashboard' }
  }
  // Pages the user's role can't use (the API refuses them too; this just avoids showing an error)
  if (to.meta.adminOnly && !user?.role.isAdmin) {
    return { name: 'dashboard' }
  }
  if (to.meta.permission && !user?.permissions.includes(to.meta.permission)) {
    return { name: 'dashboard' }
  }
  // Nothing can be saved while the subscription is expired (the banner explains why)
  if (to.meta.writes && subscriptionExpired()) {
    return { name: user?.role.isAdmin ? 'subscription' : 'dashboard' }
  }
})

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    adminOnly?: boolean // only the store's Admin role (users, roles, subscription)
    permission?: Permission
    writes?: boolean // only for saving things (POS, create/edit forms); closed while the subscription is expired
    menu?: string // sidebar link to highlight
  }
}

export default router
