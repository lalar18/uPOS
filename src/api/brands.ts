import { readJson, sendJson } from './http'

export type BrandStatus = 'active' | 'inactive'

export interface Brand {
  id: number
  name: string
  status: BrandStatus
  logoUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface BrandInput {
  name: string
  status: BrandStatus
}

export interface BrandQuery {
  search: string
  status: BrandStatus | ''
  page: number
  pageSize: number
}

export async function listBrands(query: BrandQuery): Promise<{ items: Brand[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/brands?${params}`))
}

export const createBrand = (input: BrandInput) => sendJson<Brand>('POST', '/api/brands', input)

export const updateBrand = (id: number, input: BrandInput) => sendJson<Brand>('PUT', `/api/brands/${id}`, input)

export const deleteBrand = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/brands/${id}`)

export async function uploadBrandLogo(id: number, image: Blob): Promise<Brand> {
  return readJson(await fetch(`/api/brands/${id}/logo`, { method: 'PUT', body: image }))
}

export const removeBrandLogo = (id: number) => sendJson<Brand>('DELETE', `/api/brands/${id}/logo`)
