import { readJson, sendJson } from './http'

export type ProductStatus = 'active' | 'inactive'

export interface ProductUnit {
  id: number
  name: string
  shortName: string
  allowDecimal: boolean
}

export interface Product {
  id: number
  name: string
  sku: string
  barcode: string | null
  category: { id: number; name: string } | null
  brand: { id: number; name: string } | null
  unit: ProductUnit
  priceCents: number
  costCents: number | null // always null for cashiers
  quantity: number
  alertQuantity: number
  description: string | null
  status: ProductStatus
  imageUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductInput {
  name: string
  sku: string
  barcode: string | null
  categoryId: number | null
  brandId: number | null
  unitId: number
  priceCents: number
  costCents: number | null
  quantity: number
  alertQuantity: number
  description: string | null
  status: ProductStatus
}

export interface ProductQuery {
  search: string
  status: ProductStatus | ''
  categoryId: number | null
  brandId: number | null
  page: number
  pageSize: number
}

export interface ProductOption {
  id: number
  name: string
  status: ProductStatus
}

export interface ProductOptions {
  categories: ProductOption[]
  brands: ProductOption[]
  units: (ProductUnit & { status: ProductStatus })[]
}

export async function listProducts(query: ProductQuery): Promise<{ items: Product[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.categoryId) params.set('categoryId', String(query.categoryId))
  if (query.brandId) params.set('brandId', String(query.brandId))
  return readJson(await fetch(`/api/products?${params}`))
}

export async function getProduct(id: number): Promise<Product> {
  return readJson(await fetch(`/api/products/${id}`))
}

export async function getProductOptions(): Promise<ProductOptions> {
  return readJson(await fetch('/api/products/options'))
}

export const createProduct = (input: ProductInput) => sendJson<Product>('POST', '/api/products', input)

export const updateProduct = (id: number, input: ProductInput) =>
  sendJson<Product>('PUT', `/api/products/${id}`, input)

export const deleteProduct = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/products/${id}`)

export async function uploadProductImage(id: number, image: Blob): Promise<Product> {
  return readJson(await fetch(`/api/products/${id}/image`, { method: 'PUT', body: image }))
}

export const removeProductImage = (id: number) => sendJson<Product>('DELETE', `/api/products/${id}/image`)

const pesoFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

/** 1250 -> "₱12.50" */
export const formatPeso = (cents: number) => pesoFormat.format(cents / 100)

/** 1.5 -> "1.5", 12 -> "12" (stock is kept to 3 decimals) */
export const formatQuantity = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })

/** A random SKU like "PRD-7K2QX9" for products that don't have one printed */
export function generateSku(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I to misread
  const random = crypto.getRandomValues(new Uint8Array(6))
  return `PRD-${[...random].map((b) => chars[b % chars.length]).join('')}`
}
