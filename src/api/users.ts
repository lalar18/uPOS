import { readJson, sendJson } from './http'
import type { RoleSummary } from './roles'

/** A user as listed on the Users page (admins only). */
export interface ManagedUser {
  id: number
  email: string
  fullName: string
  role: RoleSummary
  active: boolean
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface ManagedUserInput {
  email: string
  fullName: string
  roleId: number
  active: boolean
  password?: string // required when adding; ignored when editing
}

export interface UserQuery {
  search: string
  roleId: number | null
  status: 'active' | 'inactive' | ''
  page: number
  pageSize: number
}

/** Keep in step with MIN_PASSWORD_LENGTH in worker/password.ts */
export const MIN_PASSWORD_LENGTH = 8

export async function listUsers(query: UserQuery): Promise<{ items: ManagedUser[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.roleId !== null) params.set('roleId', String(query.roleId))
  if (query.status) params.set('status', query.status)
  return readJson(await fetch(`/api/users?${params}`))
}

export const createUser = (input: ManagedUserInput) => sendJson<ManagedUser>('POST', '/api/users', input)

export const updateUser = (id: number, input: ManagedUserInput) =>
  sendJson<ManagedUser>('PUT', `/api/users/${id}`, input)

export const resetUserPassword = (id: number, password: string) =>
  sendJson<{ ok: true }>('PUT', `/api/users/${id}/password`, { password })

export const deleteUser = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/users/${id}`)
