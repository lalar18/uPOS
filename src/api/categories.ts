import { readJson, sendJson } from './http'

export type CategoryStatus = 'active' | 'inactive'

export interface Category {
  id: number
  name: string
  slug: string
  status: CategoryStatus
  createdAt: string
  updatedAt: string
}

export interface CategoryInput {
  name: string
  slug: string
  status: CategoryStatus
}

export interface CategoryQuery {
  search: string
  status: CategoryStatus | ''
  page: number
  pageSize: number
}

export async function listCategories(query: CategoryQuery): Promise<{ items: Category[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/categories?${params}`))
}

export const createCategory = (input: CategoryInput) => sendJson<Category>('POST', '/api/categories', input)

export const updateCategory = (id: number, input: CategoryInput) =>
  sendJson<Category>('PUT', `/api/categories/${id}`, input)

export const deleteCategory = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/categories/${id}`)

/** Same rules as the server: "Fresh Fruits & Veg" -> "fresh-fruits-veg" */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
