// Validation shared by the people records (customers and suppliers): phone, email, address, status.

import { cleanText, error } from './documents'

export type Status = 'active' | 'inactive'

export interface ContactFields {
  phone: string | null
  email: string | null
  address: string | null
  status: Status
}

export const MAX_PERSON_NAME_LENGTH = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+()\-\s]+$/

/** Reads the shared contact fields from a body. Blank values become null; a missing status is active. */
export function readContactFields(body: Record<string, unknown>): ContactFields | Response {
  const phone = cleanText(body.phone) || null
  if (phone && (phone.length > 30 || !PHONE_PATTERN.test(phone))) {
    return error('Phone can only contain numbers, spaces and + ( ) -', 400)
  }
  const email = cleanText(body.email) || null
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) return error('Enter a valid email address', 400)
  const address = cleanText(body.address) || null
  if (address && address.length > 255) return error('Address must be 255 characters or less', 400)

  const status = body.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { phone, email, address, status }
}

/** A required name (label is e.g. "Customer name"), or an error Response. */
export function readPersonName(value: unknown, label: string): string | Response {
  const name = cleanText(value)
  if (!name) return error(`${label} is required`, 400)
  if (name.length > MAX_PERSON_NAME_LENGTH) return error(`${label} must be ${MAX_PERSON_NAME_LENGTH} characters or less`, 400)
  return name
}
