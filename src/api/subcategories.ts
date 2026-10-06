import { readJson, sendJson } from './http'

export type SubcategoryStatus = 'active' | 'inactive'

export interface Subcategory {
  id: number
  category: { id: number; name: string }
  name: string
  description: string | null
  status: SubcategoryStatus
  createdAt: string
  updatedAt: string
}

export interface SubcategoryInput {
  categoryId: number
  name: string
  description: string | null
  status: SubcategoryStatus
}

export interface SubcategoryQuery {
  search: string
  status: SubcategoryStatus | ''
  categoryId: number | null
  page: number
  pageSize: number
}

export async function listSubcategories(query: SubcategoryQuery): Promise<{ items: Subcategory[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.categoryId) params.set('categoryId', String(query.categoryId))
  return readJson(await fetch(`/api/subcategories?${params}`))
}

export const createSubcategory = (input: SubcategoryInput) =>
  sendJson<Subcategory>('POST', '/api/subcategories', input)

export const updateSubcategory = (id: number, input: SubcategoryInput) =>
  sendJson<Subcategory>('PUT', `/api/subcategories/${id}`, input)

export const deleteSubcategory = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/subcategories/${id}`)
