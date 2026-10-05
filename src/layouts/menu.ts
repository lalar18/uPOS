// Sidebar navigation. Add a route in router.ts when a page is built;
// until then its link opens the "coming soon" placeholder.

export interface MenuItem {
  label: string
  to: string
  icon: string // tabler icon name, without the "ti-" prefix
  adminOnly?: boolean
}

export interface MenuSection {
  title: string
  items: MenuItem[]
}

export const menu: MenuSection[] = [
  {
    title: 'Main',
    items: [{ label: 'Dashboard', to: '/', icon: 'layout-grid' }],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Products', to: '/products', icon: 'box' },
      { label: 'Create Product', to: '/products/create', icon: 'table-plus' },
      { label: 'Expired Products', to: '/products/expired', icon: 'progress-alert' },
      { label: 'Low Stocks', to: '/products/low-stocks', icon: 'trending-up-2' },
      { label: 'Category', to: '/categories', icon: 'list-details' },
      { label: 'Sub Category', to: '/sub-categories', icon: 'carousel-vertical' },
      { label: 'Brands', to: '/brands', icon: 'triangles' },
      { label: 'Units', to: '/units', icon: 'brand-unity' },
      { label: 'Variant Attributes', to: '/variant-attributes', icon: 'checklist' },
      { label: 'Warranties', to: '/warranties', icon: 'certificate-2' },
      { label: 'Print Barcode', to: '/print-barcode', icon: 'barcode' },
      { label: 'Print QR Code', to: '/print-qrcode', icon: 'qrcode' },
    ],
  },
  {
    title: 'Stock',
    items: [
      { label: 'Manage Stock', to: '/stock', icon: 'stack-3' },
      { label: 'Stock Adjustment', to: '/stock/adjustments', icon: 'stairs-up' },
      { label: 'Stock Transfer', to: '/stock/transfers', icon: 'stack-pop' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'Sales', to: '/sales', icon: 'shopping-cart' },
      { label: 'Invoices', to: '/invoices', icon: 'file-invoice' },
      { label: 'Sales Return', to: '/sales/returns', icon: 'receipt-refund' },
      { label: 'Quotation', to: '/quotations', icon: 'file-description' },
      { label: 'POS', to: '/pos', icon: 'device-laptop' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Customers', to: '/customers', icon: 'users-group' },
      { label: 'Suppliers', to: '/suppliers', icon: 'user-dollar' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Sales Report', to: '/reports/sales', icon: 'chart-bar' },
      { label: 'Profit & Loss', to: '/reports/profit-loss', icon: 'report-money' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Users', to: '/users', icon: 'users', adminOnly: true },
      { label: 'Stores', to: '/stores', icon: 'building-store', adminOnly: true },
      { label: 'General Settings', to: '/settings', icon: 'settings', adminOnly: true },
    ],
  },
]
