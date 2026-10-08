// The signed-in super admin (US Panel). Separate from auth.ts: a browser can be signed in
// to a store and to the panel at the same time, and each has its own cookie.
import { ref } from 'vue'
import type { SuperAdmin } from './api/usPanel'

export const currentSuperAdmin = ref<SuperAdmin | null>(null)

let sessionChecked = false

/** Asks the API which super admin is signed in (once per page load). */
export async function loadSuperAdmin(): Promise<SuperAdmin | null> {
  if (!sessionChecked) {
    const res = await fetch('/api/us-panel/me')
    currentSuperAdmin.value = res.ok ? await res.json() : null
    sessionChecked = true
  }
  return currentSuperAdmin.value
}

export async function loginSuperAdmin(email: string, password: string): Promise<void> {
  const res = await fetch('/api/us-panel/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Login failed')

  currentSuperAdmin.value = data
  sessionChecked = true
}

export async function logoutSuperAdmin(): Promise<void> {
  await fetch('/api/us-panel/logout', { method: 'POST' })
  currentSuperAdmin.value = null
}
