import { readJson, sendJson } from './http'

export interface Store {
  id: number
  name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  tin: string | null
  receiptFooter: string // printed at the bottom of receipts; set on General Settings
  createdAt: string
  updatedAt: string
}

/** Blank optional fields are saved as empty. */
export interface StoreInput {
  name: string
  email: string
  phone: string
  address: string
  city: string
  province: string
  postalCode: string
  tin: string
}

/** The logged-in user's store. */
export async function getStore(): Promise<Store> {
  return readJson(await fetch('/api/store'))
}

export const updateStore = (input: StoreInput) => sendJson<Store>('PUT', '/api/store', input)
