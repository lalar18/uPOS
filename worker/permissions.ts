// Permissions a role can grant. The store's Admin role has all of them, and is the only
// role that can manage users and roles (so nobody can give themselves more access).
// Keep in step with PERMISSIONS in src/api/roles.ts, which has the labels.

import type { SessionUser } from './session'

export const PERMISSIONS = [
  'products.manage', // add, edit and delete products; see cost prices
  'catalog.manage', // categories, sub categories, brands, units, variant attributes, warranties
  'stock.adjust',
  'sales.create', // POS and sales, and recording payments
  'sales.price', // sell at a price other than the product's
  'sales.returns',
  'quotations.manage', // create, edit and change the status of quotations
  'quotations.delete',
  'customers.manage', // edit and delete customers (anyone can add one at the till)
  'suppliers.manage',
  'store.manage',
  'settings.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const isPermission = (value: unknown): value is Permission => PERMISSIONS.includes(value as Permission)

/** Reads a role's stored JSON list, dropping anything that's no longer a permission. */
export function parsePermissions(json: string): Permission[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter(isPermission) : []
  } catch {
    return []
  }
}

export const can = (user: SessionUser, permission: Permission) => user.permissions.has(permission)
