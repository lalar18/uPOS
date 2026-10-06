import { readJson, sendJson } from './http'

export type CustomerStatus = 'active' | 'inactive'

export interface Customer {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  status: CustomerStatus
  saleCount: number
  quotationCount: number
  balanceCents: number // unpaid balance across their sales
  createdAt: string
}

/** The customer chosen on a sale or quotation (null there means a walk-in customer). */
export interface PickedCustomer {
  id: number
  name: string
  phone: string | null
}

export interface CustomerInput {
  name: string
  phone: string
  email: string
  address: string
  status?: CustomerStatus // defaults to active
}

export async function listCustomers(query: {
  search: string
  status?: CustomerStatus | ''
  page: number
  pageSize: number
}): Promise<{ items: Customer[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/customers?${params}`))
}

export const createCustomer = (input: CustomerInput) => sendJson<Customer>('POST', '/api/customers', input)

export const updateCustomer = (id: number, input: CustomerInput) =>
  sendJson<Customer>('PUT', `/api/customers/${id}`, input)

export const deleteCustomer = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/customers/${id}`)
