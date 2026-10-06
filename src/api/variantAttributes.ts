import { readJson, sendJson } from './http'

export type VariantAttributeStatus = 'active' | 'inactive'

export interface VariantAttribute {
  id: number
  name: string
  values: string[]
  status: VariantAttributeStatus
  createdAt: string
  updatedAt: string
}

export interface VariantAttributeInput {
  name: string
  values: string[]
  status: VariantAttributeStatus
}

export interface VariantAttributeQuery {
  search: string
  status: VariantAttributeStatus | ''
  page: number
  pageSize: number
}

export async function listVariantAttributes(
  query: VariantAttributeQuery,
): Promise<{ items: VariantAttribute[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/variant-attributes?${params}`))
}

export const createVariantAttribute = (input: VariantAttributeInput) =>
  sendJson<VariantAttribute>('POST', '/api/variant-attributes', input)

export const updateVariantAttribute = (id: number, input: VariantAttributeInput) =>
  sendJson<VariantAttribute>('PUT', `/api/variant-attributes/${id}`, input)

export const deleteVariantAttribute = (id: number) =>
  sendJson<{ ok: true }>('DELETE', `/api/variant-attributes/${id}`)
