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

/** The store's code, e.g. "STR-00001": quote it to the system provider (it's the store's id). */
export const storeCode = (id: number) => `STR-${String(id).padStart(5, '0')}`

// --- Online payouts (see worker/storePayouts.ts) ---

/** A payout of online sales from the platform to a store */
export interface StorePayout {
  id: number
  reference: string // "PO-00007"
  amountCents: number
  method: string
  paymentReference: string | null
  note: string | null
  paidDate: string // YYYY-MM-DD
  recordedBy: string | null
  createdAt: string
}

/** Sales paid online go to the platform's PayMongo account, which pays them out to the store */
export interface PayoutSummary {
  collectedCents: number // sale amounts paid online (without service charges)
  onlinePayments: number
  paidOutCents: number
  balanceCents: number // still owed to the store
  payouts: StorePayout[] // newest first
  // Paid online after the sale was already settled: the customer is owed a refund
  refundsDue: {
    id: number
    sale: { id: number; reference: string }
    method: string
    paidCents: number
    paymentReference: string | null
    paidAt: string | null
  }[]
}

/** Store admins only */
export const getOnlinePayouts = async (): Promise<PayoutSummary> => readJson(await fetch('/api/online-payouts'))
