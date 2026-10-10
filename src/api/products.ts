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
  subcategory: { id: number; name: string } | null
  brand: { id: number; name: string } | null
  unit: ProductUnit
  priceCents: number
  costCents: number | null // always null for cashiers
  quantity: number
  alertQuantity: number
  description: string | null
  manufacturedDate: string | null // YYYY-MM-DD
  expiryDate: string | null // YYYY-MM-DD
  warranty: { id: number; name: string } | null
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
  subcategoryId: number | null
  brandId: number | null
  unitId: number
  priceCents: number
  costCents: number | null
  quantity: number
  alertQuantity: number
  description: string | null
  manufacturedDate: string | null
  expiryDate: string | null
  warrantyId: number | null
  status: ProductStatus
}

export interface ProductQuery {
  search: string
  status: ProductStatus | ''
  categoryId: number | null
  subcategoryId: number | null
  brandId: number | null
  stock?: 'low' | 'out' // low: 0 < quantity <= alert quantity; out: quantity <= 0
  expiresFrom?: string // YYYY-MM-DD, inclusive
  expiresBefore?: string // YYYY-MM-DD, exclusive
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
  subcategories: (ProductOption & { categoryId: number })[]
  brands: ProductOption[]
  units: (ProductUnit & { status: ProductStatus })[]
  warranties: (ProductOption & { duration: number; durationUnit: 'day' | 'month' | 'year' })[]
}

export async function listProducts(query: ProductQuery): Promise<{ items: Product[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.categoryId) params.set('categoryId', String(query.categoryId))
  if (query.subcategoryId) params.set('subcategoryId', String(query.subcategoryId))
  if (query.brandId) params.set('brandId', String(query.brandId))
  if (query.stock) params.set('stock', query.stock)
  if (query.expiresFrom) params.set('expiresFrom', query.expiresFrom)
  if (query.expiresBefore) params.set('expiresBefore', query.expiresBefore)
  return readJson(await fetch(`/api/products?${params}`))
}

/**
 * The active product whose barcode or SKU is exactly the scanned code, or null. A UPC-A code
 * read as EAN-13 has an extra leading 0, so a 13-digit code starting with 0 also matches
 * the 12-digit barcode (and the other way round).
 */
export async function findProductByCode(code: string): Promise<Product | null> {
  const text = code.trim().toLowerCase()
  if (!text) return null
  const upc = /^0\d{12}$/.test(text) ? text.slice(1) : text
  const codes = new Set([text, upc, /^\d{12}$/.test(text) ? `0${text}` : text])
  const { items } = await listProducts({
    search: upc, // also finds the 13-digit form, which contains it
    status: 'active',
    categoryId: null,
    subcategoryId: null,
    brandId: null,
    page: 1,
    pageSize: 50,
  })
  return (
    items.find((p) => p.barcode && codes.has(p.barcode.toLowerCase())) ??
    items.find((p) => codes.has(p.sku.toLowerCase())) ??
    null
  )
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

/** 1.5 -> "1.5", 12 -> "12" (stock is kept to 3 decimals) */
export const formatQuantity = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })

/** A random SKU like "PRD-7K2QX9" for products that don't have one printed */
export function generateSku(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I to misread
  const random = crypto.getRandomValues(new Uint8Array(6))
  return `PRD-${[...random].map((b) => chars[b % chars.length]).join('')}`
}
