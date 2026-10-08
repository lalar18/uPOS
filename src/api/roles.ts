import { readJson, sendJson } from './http'

/** Keep in step with PERMISSIONS in worker/permissions.ts */
export const PERMISSION_GROUPS = [
  {
    title: 'Inventory',
    permissions: [
      { key: 'products.manage', label: 'Manage products', hint: 'Add, edit and delete products, and see cost prices' },
      {
        key: 'catalog.manage',
        label: 'Manage catalog',
        hint: 'Categories, sub categories, brands, units, variant attributes and warranties',
      },
      { key: 'stock.adjust', label: 'Adjust stock', hint: 'Add, remove or set stock quantities' },
    ],
  },
  {
    title: 'Sales',
    permissions: [
      { key: 'sales.create', label: 'Sell', hint: 'Use the POS, create sales and record payments' },
      { key: 'sales.price', label: 'Change prices', hint: "Sell at a price other than the product's" },
      { key: 'sales.returns', label: 'Record sales returns', hint: 'Returns can refund money' },
      { key: 'quotations.manage', label: 'Manage quotations', hint: 'Create, edit and change their status' },
      { key: 'quotations.delete', label: 'Delete quotations', hint: '' },
    ],
  },
  {
    title: 'People',
    permissions: [
      { key: 'customers.manage', label: 'Edit customers', hint: 'Anyone can add a customer; this allows editing and deleting' },
      { key: 'suppliers.manage', label: 'Manage suppliers', hint: 'Add, edit and delete suppliers' },
    ],
  },
  {
    title: 'Settings',
    permissions: [
      { key: 'store.manage', label: 'Edit store information', hint: 'Name, address and TIN on receipts' },
      { key: 'settings.manage', label: 'Change general settings', hint: 'Default tax rate, quotation validity, receipt footer' },
    ],
  },
] as const

export type Permission = (typeof PERMISSION_GROUPS)[number]['permissions'][number]['key']

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))

/** The role shown on a user. */
export interface RoleSummary {
  id: number
  name: string
  isAdmin: boolean // the store's built-in Admin role: every permission, manages users and roles
}

export interface Role extends RoleSummary {
  permissions: Permission[]
  userCount: number
  createdAt: string
  updatedAt: string
}

export interface RoleInput {
  name: string
  permissions: Permission[]
}

export const listRoles = async (): Promise<Role[]> => (await readJson<{ items: Role[] }>(await fetch('/api/roles'))).items

export const createRole = (input: RoleInput) => sendJson<Role>('POST', '/api/roles', input)

export const updateRole = (id: number, input: RoleInput) => sendJson<Role>('PUT', `/api/roles/${id}`, input)

export const deleteRole = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/roles/${id}`)
