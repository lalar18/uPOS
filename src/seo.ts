// Per-page title, description, canonical URL and robots tag (the landing page's full set,
// with link previews and structured data, is in index.html). Only the public pages are indexed;
// the signed-in app, login and US Panel get "noindex".
import type { RouteLocationNormalized } from 'vue-router'
import { currentUser } from './auth'
import { legalDocs, type LegalDocId } from './views/landing/legalDocs'

const SITE_URL = 'https://muntingdahan.store'
const SITE_NAME = 'MuntingDahan POS'
const HOME_TITLE = `${SITE_NAME}: Cloud POS with QR Ph Payments for Philippine Stores`
const HOME_DESCRIPTION =
  'Cloud point of sale for sari-sari stores, groceries, pharmacies and shops in the Philippines. Barcode scanning, GCash, Maya and QR Ph payments, inventory and reports in your browser. Free 1-month trial.'

const LEGAL_ROUTES: Record<string, LegalDocId> = { terms: 'terms', privacy: 'privacy', 'refund-policy': 'refunds' }

interface PageSeo {
  title: string
  description: string
  path: string
  index: boolean
}

function pageSeo(to: RouteLocationNormalized): PageSeo {
  const name = String(to.name ?? '')
  // Signed out, "/" is the landing page (HomeLayout)
  if (name === 'dashboard' && !currentUser.value) {
    return { title: HOME_TITLE, description: HOME_DESCRIPTION, path: '/', index: true }
  }
  const legal = LEGAL_ROUTES[name]
  if (legal) {
    const doc = legalDocs[legal]
    return { title: `${doc.title} | ${SITE_NAME}`, description: doc.summary, path: to.path, index: true }
  }
  return { title: SITE_NAME, description: HOME_DESCRIPTION, path: to.path, index: false }
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

export function applySeo(to: RouteLocationNormalized) {
  const page = pageSeo(to)
  const url = SITE_URL + page.path

  document.title = page.title
  setMeta('name', 'description', page.description)
  setMeta('name', 'robots', page.index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
  setMeta('property', 'og:title', page.title)
  setMeta('property', 'og:description', page.description)
  setMeta('property', 'og:url', url)

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.appendChild(canonical)
  }
  canonical.href = url
}
