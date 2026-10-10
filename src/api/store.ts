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

// --- Wallet: online sales held by the platform until withdrawn (see worker/storePayouts.ts) ---

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
  // Sent through PayMongo: our reference and PayMongo's transfer id
  transfer: { reference: string; transferId: string | null; provider: string | null } | null
}

export type TransferStatus = 'pending' | 'succeeded' | 'failed'

/** A withdrawal sent from the platform's PayMongo Wallet, kept whatever happened to it */
export interface PayoutTransfer {
  id: number
  withdrawalId: number
  reference: string // ours, e.g. "WD00012T1" (withdrawal 12, first attempt)
  transferId: string | null // PayMongo's (tr_…)
  providerReference: string | null // InstaPay's or PESONet's, on the bank statement
  provider: 'instapay' | 'pesonet'
  amountCents: number
  feeCents: number | null // what PayMongo charged the platform
  bankName: string
  accountName: string
  accountNumber: string
  status: TransferStatus
  failureMessage: string | null
  sentBy: string
  createdAt: string
  completedAt: string | null
}

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; class: string }> = {
  pending: { label: 'Sending', class: 'bg-info' },
  succeeded: { label: 'Sent', class: 'bg-success' },
  failed: { label: 'Failed', class: 'bg-danger' },
}

export const transferProviderLabel = (provider: string | null) =>
  provider === 'pesonet' ? 'PESONet' : provider === 'instapay' ? 'InstaPay' : 'PayMongo'

export type WithdrawalDestination = 'gcash' | 'bank'
export type WithdrawalStatus = 'pending' | 'sent' | 'rejected' | 'cancelled'

/** A store's request to withdraw from its wallet to a GCash number or bank account */
export interface WalletWithdrawal {
  id: number
  reference: string // "WD-00003"
  amountCents: number
  destination: WithdrawalDestination
  bankCode: string | null // from PayMongo's list of banks (null if typed in)
  bankName: string | null // bank only
  accountName: string
  accountNumber: string
  note: string | null
  status: WithdrawalStatus
  sending: boolean // being sent through PayMongo right now (it can't be cancelled)
  transfer: PayoutTransfer | null // its latest transfer through PayMongo
  payout: { id: number; reference: string } | null // once sent
  rejectReason: string | null
  requestedBy: string
  createdAt: string
  reviewedAt: string | null
}

/** Sales paid online go to the platform's PayMongo account, which holds them for the store */
export interface Wallet {
  collectedCents: number // sale amounts paid online (without service charges)
  onlinePayments: number
  paidOutCents: number
  balanceCents: number // held for the store
  pendingWithdrawalCents: number
  availableCents: number // can be withdrawn now
  payouts: StorePayout[] // newest first
  withdrawals: WalletWithdrawal[] // newest first
  pendingWithdrawal: WalletWithdrawal | null
  transfers: PayoutTransfer[] // through PayMongo, newest first
  transfersEnabled: boolean // withdrawals can be sent through PayMongo
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

export interface WithdrawalInput {
  amountCents: number
  destination: WithdrawalDestination
  bankCode: string // from the list of banks, when there is one
  bankName: string // typed in when there's no list
  accountName: string
  accountNumber: string
  note: string
}

/** A bank or e-wallet withdrawals can be sent to */
export interface Bank {
  code: string
  name: string
}

export const WITHDRAWAL_STATUS: Record<WithdrawalStatus, { label: string; class: string }> = {
  pending: { label: 'Pending', class: 'bg-warning' },
  sent: { label: 'Sent', class: 'bg-success' },
  rejected: { label: 'Rejected', class: 'bg-danger' },
  cancelled: { label: 'Cancelled', class: 'bg-secondary' },
}

/** "GCash 0917 123 4567" or "BDO · 001234567890" */
export const describeDestination = (w: Pick<WalletWithdrawal, 'destination' | 'bankName' | 'accountNumber'>) =>
  w.destination === 'gcash'
    ? `GCash ${w.accountNumber.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')}`
    : `${w.bankName} · ${w.accountNumber}`

// Store admins only
export const getWallet = async (): Promise<Wallet> => readJson(await fetch('/api/wallet'))

/** PayMongo's banks to withdraw to, or null when the bank name is typed in instead */
export const getWithdrawalBanks = async (): Promise<Bank[] | null> =>
  (await readJson<{ banks: Bank[] | null }>(await fetch('/api/wallet/banks'))).banks

export const requestWithdrawal = (input: WithdrawalInput) => sendJson<Wallet>('POST', '/api/wallet/withdrawals', input)

export const cancelWithdrawal = (id: number) => sendJson<Wallet>('DELETE', `/api/wallet/withdrawals/${id}`)
