import { readJson, sendJson } from './http'

export interface Customer {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  status: 'active' | 'inactive'
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
}

export async function listCustomers(query: {
  search: string
  status?: 'active' | 'inactive'
  page: number
  pageSize: number
}): Promise<{ items: Customer[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/customers?${params}`))
}

export const createCustomer = (input: CustomerInput) => sendJson<Customer>('POST', '/api/customers', input)
