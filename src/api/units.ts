import { readJson, sendJson } from './http'

export type UnitStatus = 'active' | 'inactive'

export interface Unit {
  id: number
  name: string
  shortName: string
  allowDecimal: boolean
  status: UnitStatus
  productCount: number
  createdAt: string
  updatedAt: string
}

export interface UnitInput {
  name: string
  shortName: string
  allowDecimal: boolean
  status: UnitStatus
}

export interface UnitQuery {
  search: string
  status: UnitStatus | ''
  page: number
  pageSize: number
}

export async function listUnits(query: UnitQuery): Promise<{ items: Unit[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/units?${params}`))
}

export const createUnit = (input: UnitInput) => sendJson<Unit>('POST', '/api/units', input)

export const updateUnit = (id: number, input: UnitInput) => sendJson<Unit>('PUT', `/api/units/${id}`, input)

export const deleteUnit = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/units/${id}`)
