import { readJson, sendJson } from './http'

export type SupplierStatus = 'active' | 'inactive'

export interface Supplier {
  id: number
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  note: string | null
  status: SupplierStatus
  createdAt: string
  updatedAt: string
}

export interface SupplierInput {
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  note: string
  status: SupplierStatus
}

export interface SupplierQuery {
  search: string
  status: SupplierStatus | ''
  page: number
  pageSize: number
}

export async function listSuppliers(query: SupplierQuery): Promise<{ items: Supplier[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/suppliers?${params}`))
}

export const createSupplier = (input: SupplierInput) => sendJson<Supplier>('POST', '/api/suppliers', input)

export const updateSupplier = (id: number, input: SupplierInput) =>
  sendJson<Supplier>('PUT', `/api/suppliers/${id}`, input)

export const deleteSupplier = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/suppliers/${id}`)
