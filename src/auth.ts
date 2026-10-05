import { ref } from 'vue'

export interface User {
  id: number
  email: string
  fullName: string
  role: 'admin' | 'cashier'
}

/** The logged-in user, or null when signed out. Shared across the app. */
export const currentUser = ref<User | null>(null)

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
