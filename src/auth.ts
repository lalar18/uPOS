import { ref } from 'vue'
import { parseDbDate, readJson } from './api/http'
import type { Permission, RoleSummary } from './api/roles'

export interface User {
  id: number
  email: string
  fullName: string
  role: RoleSummary
  permissions: Permission[] // every permission for admins
  store: { id: number; name: string; subscription: StoreSubscription } // every user belongs to exactly one store
  avatarUrl: string | null
}

export interface StoreSubscription {
  expiresAt: string | null // UTC "YYYY-MM-DD HH:MM:SS"
  expired: boolean // the store is read-only until renewed
}

/** The logged-in user, or null when signed out. Shared across the app. */
export const currentUser = ref<User | null>(null)

/** True when the logged-in user's role has this permission. Reactive inside computed() and templates. */
export const can = (permission: Permission) => currentUser.value?.permissions.includes(permission) ?? false

/** True when the logged-in user has the store's Admin role (the only one that manages users and roles). */
export const isAdmin = () => currentUser.value?.role.isAdmin ?? false

/** True when the store's subscription has run out, so nothing can be saved (the API refuses too). */
export function subscriptionExpired(): boolean {
  const subscription = currentUser.value?.store.subscription
  if (!subscription) return false
  return subscription.expired || !subscription.expiresAt || parseDbDate(subscription.expiresAt) <= new Date()
}

let sessionChecked = false

/** Asks the API who is logged in (once per page load). */
export async function loadSession(): Promise<User | null> {
  if (!sessionChecked) {
    const res = await fetch('/api/me')
    currentUser.value = res.ok ? await res.json() : null
    sessionChecked = true
  }
  return currentUser.value
}

export async function login(email: string, password: string, rememberMe: boolean): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, rememberMe }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Login failed')

  currentUser.value = data
  sessionChecked = true
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' })
  currentUser.value = null
}

/** Uploads an already-cropped image as the current user's avatar. */
export async function uploadAvatar(image: Blob): Promise<void> {
  const res = await fetch('/api/profile/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': image.type },
    body: image,
  })
  currentUser.value = await readJson<User>(res)
}

export async function removeAvatar(): Promise<void> {
  const res = await fetch('/api/profile/avatar', { method: 'DELETE' })
  currentUser.value = await readJson<User>(res)
}

/** Changes the password; other devices signed in to this account are logged out. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  await readJson(res)
}
