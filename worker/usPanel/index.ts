// The US Panel API (/api/us-panel/*): the platform owner's back office for supporting stores.
// Only super admins can use it; store users (even store admins) never can.

import { error } from '../documents'
import { listStoreRenewals, handleRenewals, recordStorePayment } from './billing'
import { getOverview } from './overview'
import { handlePlans } from './plans'
import { changePassword, getSuperAdmin, login, logout, publicSuperAdmin } from './session'
import { handleStores } from './stores'

export async function handleUsPanel(db: D1Database, request: Request, url: URL): Promise<Response> {
  const path = url.pathname

  if (path === '/api/us-panel/login') {
    return request.method === 'POST' ? login(db, request) : error('Method not allowed', 405)
  }
  if (path === '/api/us-panel/logout') {
    return request.method === 'POST' ? logout(db, request) : error('Method not allowed', 405)
  }

  // Everything below requires a signed-in super admin
  const admin = await getSuperAdmin(db, request)
  if (!admin) return error('Not logged in', 401)

  if (path === '/api/us-panel/me' && request.method === 'GET') return Response.json(publicSuperAdmin(admin))
  if (path === '/api/us-panel/me/password' && request.method === 'PUT') return changePassword(db, request, admin)
  if (path === '/api/us-panel/overview' && request.method === 'GET') return getOverview(db)

  // A store's billing (checked before the other store routes)
  const billingMatch = path.match(/^\/api\/us-panel\/stores\/(\d+)\/(renewals|payments)$/)
  if (billingMatch) {
    const storeId = Number(billingMatch[1])
    if (billingMatch[2] === 'renewals' && request.method === 'GET') {
      return Response.json(await listStoreRenewals(db, storeId))
    }
    if (billingMatch[2] === 'payments' && request.method === 'POST') {
      return recordStorePayment(db, request, storeId, admin)
    }
    return error('Method not allowed', 405)
  }

  if (path === '/api/us-panel/stores' || path.startsWith('/api/us-panel/stores/')) {
    const response = await handleStores(db, request, url)
    if (response) return response
  }
  if (path.startsWith('/api/us-panel/renewals')) {
    const response = await handleRenewals(db, request, url, admin)
    if (response) return response
  }
  if (path.startsWith('/api/us-panel/plans')) {
    const response = await handlePlans(db, request, url)
    if (response) return response
  }

  return error('Not found', 404)
}
