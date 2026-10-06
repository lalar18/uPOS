import { readJson, sendJson } from './http'

export type WarrantyStatus = 'active' | 'inactive'
export type WarrantyDurationUnit = 'day' | 'month' | 'year'

export interface Warranty {
  id: number
  name: string
  description: string | null
  duration: number
  durationUnit: WarrantyDurationUnit
  status: WarrantyStatus
  productCount: number
  createdAt: string
  updatedAt: string
}

export interface WarrantyInput {
  name: string
  description: string | null
  duration: number
  durationUnit: WarrantyDurationUnit
  status: WarrantyStatus
}

export interface WarrantyQuery {
  search: string
  status: WarrantyStatus | ''
  page: number
  pageSize: number
}

export async function listWarranties(query: WarrantyQuery): Promise<{ items: Warranty[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/warranties?${params}`))
}

export const createWarranty = (input: WarrantyInput) => sendJson<Warranty>('POST', '/api/warranties', input)

export const updateWarranty = (id: number, input: WarrantyInput) =>
  sendJson<Warranty>('PUT', `/api/warranties/${id}`, input)

export const deleteWarranty = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/warranties/${id}`)

/** 1, 'year' -> "1 Year"; 6, 'month' -> "6 Months" */
export function formatDuration(duration: number, unit: WarrantyDurationUnit): string {
  const label = { day: 'Day', month: 'Month', year: 'Year' }[unit]
  return `${duration} ${label}${duration === 1 ? '' : 's'}`
}
