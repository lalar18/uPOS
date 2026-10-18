<script setup lang="ts">
// Public one-page site: what USystems POS does (the counter, barcode scanning, QR Ph payments
// recorded on the sale, inventory and reports), the plans and their prices (from /api/plans,
// so they always match the real limits), and the Portal button that opens the login page.
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue'
import { describeSeats, formatPrice, getPlans, TRIAL_LABEL, type Plan } from '@/api/subscription'
import { googleSignInUrl } from '@/auth'
import { legalLinks } from './legalDocs'

/** Where "Get started" and the contact section send visitors */
const CONTACT_EMAIL = 'sales@usystems.ph'
/** The plan marked "Most popular" */
const POPULAR_PLAN = 'standard'

const menuOpen = ref(false)

const plans = ref<Plan[]>([])
const plansError = ref('')
getPlans()
  .then((list) => (plans.value = list))
  .catch(() => (plansError.value = 'Prices could not be loaded right now. Please contact us for a quote.'))

const number = new Intl.NumberFormat('en-US')

const navLinks = [
  ['features', 'Features'],
  ['online', 'Online payments'],
  ['pricing', 'Pricing'],
  ['faq', 'FAQ'],
  ['contact', 'Contact'],
] as const
const sections = ['stores', 'features', 'online', 'day', 'how', 'pricing', 'faq', 'contact']

const storeTypes = [
  { icon: 'building-store', title: 'Sari-sari stores', text: 'Quick counter sales, charge-to-account for regulars, and stock you can trust.' },
  { icon: 'shopping-cart', title: 'Groceries & minimarts', text: 'Scan barcodes at the counter and track expiry dates on perishables.' },
  { icon: 'tools', title: 'Hardware & auto parts', text: 'Big catalogs with variants, warranties, quotations and supplier records.' },
  { icon: 'pill', title: 'Pharmacies', text: 'Expiry alerts, batch-friendly stock adjustments and clean sales records.' },
  { icon: 'tools-kitchen-2', title: 'Cafés & food stalls', text: 'Fast tap-to-add menus and QR Ph payments during the lunch rush.' },
  { icon: 'shirt', title: 'Retail & boutiques', text: 'Sizes and colors as variants, printed price labels and returns handled cleanly.' },
]

const features = [
  {
    icon: 'device-desktop-dollar',
    title: 'Fast point of sale',
    text: 'Tap or search products, apply discounts and see the change instantly. Works on computers, tablets and phones.',
  },
  {
    icon: 'scan',
    title: 'Barcode & QR scanning',
    text: 'Use a USB or Bluetooth scanner, or just the camera of your phone or laptop. Set a quantity and scan once to add many.',
  },
  {
    icon: 'qrcode',
    title: 'QR Ph online payments',
    text: 'Customers scan and pay with GCash, Maya or their bank app. The payment is confirmed and recorded on the sale automatically.',
  },
  {
    icon: 'cloud-check',
    title: 'Every record in the cloud',
    text: 'Sales, payments, returns and stock changes are saved online the moment they happen. No lost notebooks, no lost files.',
  },
  {
    icon: 'packages',
    title: 'Inventory that keeps up',
    text: 'Stock per product and variant, adjustments with reasons, and alerts for low stock and expiring items.',
  },
  {
    icon: 'barcode',
    title: 'Barcode & QR labels',
    text: 'Print barcode and QR code labels for your shelves straight from your product list.',
  },
  {
    icon: 'file-invoice',
    title: 'Sales, invoices & returns',
    text: 'Every sale gets its invoice and receipt. Handle returns and refunds without breaking your numbers.',
  },
  {
    icon: 'user-dollar',
    title: 'Customers & receivables',
    text: 'Let regulars pay part now or charge to their account, and see who owes what and for how long.',
  },
  {
    icon: 'report-analytics',
    title: 'Reports & dashboards',
    text: 'Sales, profit & loss, payments, tax, inventory value and stock movement. Arrange your own dashboard.',
  },
  {
    icon: 'wallet',
    title: 'Store wallet & withdrawals',
    text: 'Online payments collect in your store wallet. Withdraw to GCash or your bank account any time.',
  },
  {
    icon: 'file-description',
    title: 'Quotations',
    text: 'Prepare quotations for customers and turn them into sales when they say yes.',
  },
  {
    icon: 'shield-lock',
    title: 'Roles & permissions',
    text: 'Give cashiers only what they need. Decide who can change prices, manage products or see costs.',
  },
]

const onlineSteps = [
  { icon: 'scan', title: 'Ring up the sale', text: 'Scan or tap the items. The sale is saved the moment you press Pay.' },
  { icon: 'qrcode', title: 'Customer scans the QR', text: 'A QR Ph code appears on screen. They pay with GCash, Maya or any bank app.' },
  { icon: 'cloud-check', title: 'Confirmed and recorded', text: 'Payment and reference are matched to the sale on their own. Stock updates too.' },
  { icon: 'building-bank', title: 'Money in your wallet', text: 'Online sales add up in your store wallet, ready to withdraw to GCash or bank.' },
]

const recordPromises = [
  { icon: 'cloud-lock', title: 'Saved as it happens', text: 'No end-of-day upload. Each sale reaches the cloud when it is rung up.' },
  { icon: 'arrows-exchange', title: 'Payments match themselves', text: 'Online payments land on the right sale with their reference, even if the cashier closed the screen.' },
  { icon: 'history', title: 'A full paper trail', text: 'Returns, stock adjustments and who sold what stay on record for audits and reports.' },
  { icon: 'devices', title: 'Open it anywhere', text: 'If a device breaks or gets lost, sign in on another one. Your records are all there.' },
]

const day = [
  { time: '6:00 AM', icon: 'sunrise', title: 'Open with a plan', text: 'Your dashboard shows low stock, items about to expire and what customers still owe.' },
  { time: '12:00 PM', icon: 'bolt', title: 'Breeze through the rush', text: 'Scan barcodes, take cash or QR Ph, and print the receipt. Each sale in seconds.' },
  { time: '3:00 PM', icon: 'truck-delivery', title: 'Restock with confidence', text: 'Receive stock from suppliers and print shelf labels for new items.' },
  { time: '9:00 PM', icon: 'moon', title: 'Close in a minute', text: "See today's sales, profit and payments by method. Everything already balanced." },
]

const steps = [
  { icon: 'brand-google', title: 'Sign up with Google', text: `Create your store in a minute and try every feature free for ${TRIAL_LABEL}.` },
  { icon: 'packages', title: 'Add your products', text: 'Enter your catalog, set prices and stock, and print labels for your shelves.' },
  { icon: 'building-store', title: 'Start selling', text: 'Open the POS on any browser and ring up your first sale the same day.' },
]

const included = [
  'Point of sale',
  'Camera & USB barcode scanning',
  'QR Ph online payments',
  'Cloud records & backups',
  'Products, variants & warranties',
  'Stock adjustments & alerts',
  'Barcode & QR label printing',
  'Sales, invoices & returns',
  'Customers & receivables',
  'Reports & dashboards',
  'Quotations',
  'Suppliers',
  'Store wallet & withdrawals',
  'Roles & permissions',
]

const faqs = [
  {
    q: 'Do I need to install anything?',
    a: 'No. USystems POS runs in your web browser, so it works on the computers, laptops, tablets and phones you already have.',
  },
  {
    q: 'What barcode scanners work with it?',
    a: 'Any USB or Bluetooth scanner that types into the search box works. No scanner? Tap Scan on the POS to read barcodes and QR codes with your camera.',
  },
  {
    q: 'How do online payments work?',
    a: 'When a customer pays by QR Ph, the POS shows a QR code for the sale. They pay with GCash, Maya or their bank app, and the payment is confirmed and recorded on the sale automatically. The money goes to your store wallet, which you can withdraw to GCash or a bank account.',
  },
  {
    q: 'Can I lose my sales records?',
    a: 'Your records are kept in the cloud, not on one device. Every sale, payment, return and stock change is saved as it happens, so a broken or lost device does not take your history with it.',
  },
  {
    q: 'Is there a fee for online payments?',
    a: 'A small service charge applies to online payments and withdrawals. It is always shown before anyone pays or withdraws. Cash sales have no extra fee.',
  },
  {
    q: 'How does billing work?',
    a: `New stores get ${TRIAL_LABEL} free. After that, plans are billed monthly and you renew from the Subscription page inside the portal.`,
  },
  {
    q: 'What happens if my subscription expires?',
    a: 'Nothing is deleted. Your store becomes view-only until you renew, so you can still look up your sales and products.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Pick another plan when you renew. A bigger plan applies when the renewal is paid; a smaller one starts when your current period ends.',
  },
]
const openFaq = ref<number | null>(0)

function go(id: string) {
  menuOpen.value = false
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

// --- Hero demo: a tiny working POS visitors can click, scan into and pay by cash or QR Ph ---

const demoProducts = [
  { name: 'Coffee 3-in-1', price: 48, icon: 'coffee' },
  { name: 'Bottled water', price: 20, icon: 'bottle' },
  { name: 'Bread loaf', price: 75, icon: 'bread' },
  { name: 'Fresh milk', price: 95, icon: 'milk' },
  { name: 'Apples (1kg)', price: 160, icon: 'apple' },
  { name: 'Cookies', price: 35, icon: 'cookie' },
]
const startingCart = () => ({ 'Coffee 3-in-1': 2, 'Bottled water': 2, 'Bread loaf': 1 }) as Record<string, number>

type DemoMethod = 'cash' | 'qrph'

const cart = ref<Record<string, number>>(startingCart())
const cartLines = computed(() =>
  demoProducts.filter((p) => cart.value[p.name]).map((p) => ({ ...p, qty: cart.value[p.name]! })),
)
const cartTotal = computed(() => cartLines.value.reduce((sum, line) => sum + line.price * line.qty, 0))
const lastAdded = ref('')
/** idle → (QR Ph: waiting for the customer) → paid */
const stage = ref<'idle' | 'waiting' | 'paid'>('idle')
const paidBy = ref<DemoMethod>('cash')
const scanning = ref(false)
const scanMessage = ref('')
const todaySales = ref(12480)
const shownSales = ref(todaySales.value)
const syncedCount = ref(37)
const timers: number[] = []

const qrSvg = ref('')
QRCode.toString('USystems POS demo payment', { type: 'svg', margin: 0, color: { dark: '#092c4c', light: '#ffffff' } })
  .then((svg) => (qrSvg.value = svg))
  .catch(() => {})

function later(fn: () => void, ms: number) {
  timers.push(window.setTimeout(fn, ms))
}

function addToCart(name: string) {
  if (stage.value !== 'idle') return
  cart.value = { ...cart.value, [name]: (cart.value[name] ?? 0) + 1 }
  lastAdded.value = name
  later(() => lastAdded.value === name && (lastAdded.value = ''), 400)
}

function removeFromCart(name: string) {
  if (stage.value !== 'idle') return
  const qty = (cart.value[name] ?? 0) - 1
  const next = { ...cart.value }
  if (qty > 0) next[name] = qty
  else delete next[name]
  cart.value = next
}

/** Pretends to read a barcode: a laser sweep, then a random product goes into the cart */
function scan() {
  if (scanning.value || stage.value !== 'idle') return
  scanning.value = true
  later(() => {
    const product = demoProducts[Math.floor(Math.random() * demoProducts.length)]!
    scanning.value = false
    addToCart(product.name)
    scanMessage.value = `Beep! ${product.name} added`
    later(() => (scanMessage.value = ''), 1600)
  }, 750)
}

function pay(method: DemoMethod) {
  if (stage.value !== 'idle' || !cartTotal.value) return
  paidBy.value = method
  if (method === 'cash') return finishSale()
  stage.value = 'waiting'
  later(finishSale, 2000)
}

function finishSale() {
  stage.value = 'paid'
  syncedCount.value++
  countTo(todaySales.value + cartTotal.value)
  later(() => {
    cart.value = {}
    stage.value = 'idle'
  }, 2400)
}

/** Animates the "Today's sales" chip up to its new value */
function countTo(target: number) {
  const from = shownSales.value
  todaySales.value = target
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min((now - start) / 900, 1)
    shownSales.value = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// --- Feature cards: a soft glow that follows the cursor ---

function trackPointer(event: MouseEvent) {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`)
  el.style.setProperty('--my', `${event.clientY - rect.top}px`)
}

// --- Scroll effects: header shadow, active nav link, reveal-on-scroll, back to top ---

const scrolled = ref(false)
const scrollY = ref(0)
const activeSection = ref('')

function onScroll() {
  scrollY.value = window.scrollY
  scrolled.value = window.scrollY > 8
}

let revealObserver: IntersectionObserver | null = null
let sectionObserver: IntersectionObserver | null = null

/** v-reveal fades an element up as it scrolls into view; the value is an optional delay in ms */
const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    el.classList.add('reveal')
    if (binding.value) el.style.transitionDelay = `${binding.value}ms`
    if (!revealObserver) {
      el.classList.add('is-visible')
      return
    }
    revealObserver.observe(el)
  },
  unmounted(el) {
    revealObserver?.unobserve(el)
  },
}

if (typeof IntersectionObserver !== 'undefined') {
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        el.classList.add('is-visible')
        revealObserver?.unobserve(el)
        // The stagger delay is only for the entrance; drop it so hover effects respond immediately
        el.addEventListener('transitionend', () => (el.style.transitionDelay = ''), { once: true })
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  )
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  if (typeof IntersectionObserver === 'undefined') return
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) activeSection.value = entry.target.id
    },
    { rootMargin: '-45% 0px -50% 0px' },
  )
  for (const id of ['top', ...sections]) {
    const el = document.getElementById(id)
    if (el) sectionObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  revealObserver?.disconnect()
  sectionObserver?.disconnect()
  timers.forEach(clearTimeout)
})
</script>

<template>
  <div class="landing">
    <!-- Header -->
    <header class="landing-header" :class="{ scrolled }">
      <div class="container d-flex align-items-center justify-content-between gap-3">
        <a href="#top" class="brand" @click.prevent="go('top')">
          <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
        </a>
        <nav class="nav-links" :class="{ open: menuOpen }">
          <a
            v-for="[id, label] in navLinks"
            :key="id"
            :href="`#${id}`"
            :class="{ active: activeSection === id }"
            @click.prevent="go(id)"
          >
            {{ label }}
          </a>
        </nav>
        <div class="d-flex align-items-center gap-2">
          <a :href="googleSignInUrl()" class="btn btn-outline-primary header-trial">Try free</a>
          <RouterLink :to="{ name: 'login' }" class="btn btn-primary portal-btn">
            <i class="ti ti-login-2 me-1"></i>Portal
          </RouterLink>
          <button
            type="button"
            class="menu-toggle btn btn-white border"
            :aria-expanded="menuOpen"
            aria-label="Menu"
            @click="menuOpen = !menuOpen"
          >
            <i class="ti" :class="menuOpen ? 'ti-x' : 'ti-menu-2'"></i>
          </button>
        </div>
      </div>
      <div class="scroll-progress" aria-hidden="true"></div>
    </header>

    <main>
      <!-- Hero -->
      <section id="top" class="hero">
        <div class="hero-bg" aria-hidden="true">
          <span class="blob blob-1"></span>
          <span class="blob blob-2"></span>
          <span class="grid"></span>
        </div>
        <div class="container position-relative">
          <div class="row align-items-center g-5">
            <div class="col-lg-6">
              <span class="pill hero-in" style="--d: 0ms">
                <span class="pill-dot"></span>Cloud POS for Philippine stores
              </span>
              <h1 class="hero-in" style="--d: 80ms">
                Scan. Sell. Get paid by QR. <span class="highlight">Every record safe in the cloud.</span>
              </h1>
              <p class="lead-text hero-in" style="--d: 160ms">
                USystems POS brings your counter, barcode scanning, QR Ph payments, inventory and reports into one
                system that runs in your browser. Every sale and payment is saved online the moment it happens.
              </p>
              <div class="d-flex flex-wrap gap-2 hero-in" style="--d: 240ms">
                <a :href="googleSignInUrl()" class="btn btn-primary btn-lg btn-glow">
                  <i class="ti ti-brand-google me-1"></i>Start free for {{ TRIAL_LABEL }}
                </a>
                <a href="#features" class="btn btn-outline-dark btn-lg" @click.prevent="go('features')">
                  See features<i class="ti ti-arrow-right ms-2 arrow"></i>
                </a>
              </div>
              <ul class="hero-points hero-in" style="--d: 320ms">
                <li><i class="ti ti-circle-check"></i>Nothing to install</li>
                <li><i class="ti ti-circle-check"></i>Camera or USB scanner</li>
                <li><i class="ti ti-circle-check"></i>GCash, Maya & bank QR</li>
                <li><i class="ti ti-circle-check"></i>No lost records</li>
              </ul>
              <div class="hero-logos hero-in" style="--d: 400ms">
                <span>Customers pay with</span>
                <img src="/assets/img/payments/qrph.svg" alt="QR Ph" />
                <img src="/assets/img/payments/gcash.svg" alt="GCash" />
                <img src="/assets/img/payments/maya.svg" alt="Maya" />
              </div>
            </div>
            <div class="col-lg-6">
              <!-- A small working POS: tap or scan products, then pay by cash or QR Ph -->
              <div class="mock-wrap hero-in" style="--d: 200ms">
                <div class="float-chip chip-sales">
                  <span class="chip-icon green"><i class="ti ti-trending-up"></i></span>
                  <div>
                    <small>Today's sales</small>
                    <strong>{{ formatPrice(shownSales) }}</strong>
                  </div>
                </div>
                <div class="float-chip chip-stock">
                  <span class="chip-icon blue"><i class="ti ti-cloud-check"></i></span>
                  <div>
                    <small>Saved to cloud</small>
                    <strong>{{ syncedCount }} sales today</strong>
                  </div>
                </div>

                <div class="mock">
                  <div class="mock-bar">
                    <span></span><span></span><span></span>
                    <em :class="{ beep: scanMessage }">{{ scanMessage || 'Try it — tap, scan or pay' }}</em>
                  </div>
                  <div class="mock-body">
                    <div class="mock-left">
                      <div class="mock-search">
                        <i class="ti ti-search"></i>
                        <span>Search or scan barcode</span>
                        <button type="button" class="mock-scan" :disabled="scanning || stage !== 'idle'" @click="scan">
                          <i class="ti ti-scan me-1"></i>Scan
                        </button>
                      </div>
                      <div class="mock-products" :class="{ scanning }">
                        <span class="laser" aria-hidden="true"></span>
                        <button
                          v-for="product in demoProducts"
                          :key="product.name"
                          type="button"
                          class="mock-product"
                          :class="{ bump: lastAdded === product.name }"
                          :aria-label="`Add ${product.name}`"
                          @click="addToCart(product.name)"
                        >
                          <i class="ti" :class="`ti-${product.icon}`"></i>
                          <span class="name">{{ product.name }}</span>
                          <span class="price">{{ formatPrice(product.price) }}</span>
                          <span class="add"><i class="ti ti-plus"></i></span>
                        </button>
                      </div>
                    </div>
                    <div class="mock-cart">
                      <div class="fw-semibold mb-2 d-flex justify-content-between">
                        <span>Current sale</span>
                        <span class="text-muted fw-normal">{{ cartLines.reduce((n, l) => n + l.qty, 0) }} items</span>
                      </div>
                      <div class="mock-lines">
                        <TransitionGroup name="line">
                          <div v-for="line in cartLines" :key="line.name" class="mock-row">
                            <button type="button" class="qty-btn" :aria-label="`Remove one ${line.name}`" @click="removeFromCart(line.name)">
                              <i class="ti ti-minus"></i>
                            </button>
                            <span class="flex-grow-1 text-truncate">{{ line.qty }} × {{ line.name }}</span>
                            <span>{{ formatPrice(line.price * line.qty) }}</span>
                          </div>
                        </TransitionGroup>
                        <div v-if="!cartLines.length && stage === 'idle'" class="mock-empty">Tap or scan a product</div>
                      </div>
                      <div class="mock-total">
                        <span>Total</span><span>{{ formatPrice(cartTotal) }}</span>
                      </div>
                      <div v-if="stage === 'idle'" class="mock-pay-row">
                        <button type="button" class="mock-pay" :disabled="!cartTotal" @click="pay('cash')">
                          <i class="ti ti-cash me-1"></i>Cash
                        </button>
                        <button type="button" class="mock-pay qr" :disabled="!cartTotal" @click="pay('qrph')">
                          <i class="ti ti-qrcode me-1"></i>QR Ph
                        </button>
                      </div>
                      <div v-else-if="stage === 'waiting'" class="mock-pay waiting">
                        <span class="spinner-border spinner-border-sm me-2"></span>Waiting for payment…
                      </div>
                      <div v-else class="mock-pay paid">
                        <i class="ti ti-cloud-check me-1"></i>{{ paidBy === 'qrph' ? 'QR Ph paid' : 'Paid' }} · saved
                      </div>
                    </div>
                  </div>

                  <!-- QR Ph: the customer scans this with their phone -->
                  <Transition name="fade">
                    <div v-if="stage === 'waiting'" class="mock-qr">
                      <div class="mock-qr-card">
                        <img src="/assets/img/payments/qrph.svg" alt="QR Ph" class="qr-brand" />
                        <div class="qr-code" v-html="qrSvg"></div>
                        <strong>Scan to pay {{ formatPrice(cartTotal) }}</strong>
                        <small>GCash · Maya · any bank app</small>
                      </div>
                    </div>
                  </Transition>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Who it's for -->
      <section id="stores" class="section section-tight">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">Made for your store</span>
            <h2>Built for every kind of tindahan</h2>
            <p>From the corner sari-sari store to a busy hardware shop, it fits how you already sell.</p>
          </div>
          <div class="stores">
            <div v-for="(store, i) in storeTypes" :key="store.title" v-reveal="(i % 3) * 80" class="store-card">
              <span class="store-icon"><i class="ti" :class="`ti-${store.icon}`"></i></span>
              <div>
                <h3>{{ store.title }}</h3>
                <p>{{ store.text }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Features -->
      <section id="features" class="section section-alt">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">Features</span>
            <h2>Everything your counter needs</h2>
            <p>Every plan includes every feature: selling, scanning, online payments, stock and reports.</p>
          </div>
          <div class="row g-4">
            <div v-for="(feature, i) in features" :key="feature.title" class="col-md-6 col-lg-4">
              <div v-reveal="(i % 3) * 90" class="feature" @mousemove="trackPointer">
                <span class="feature-icon"><i class="ti" :class="`ti-${feature.icon}`"></i></span>
                <h3>{{ feature.title }}</h3>
                <p>{{ feature.text }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- POS to online payment, on record -->
      <section id="online" class="section online">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">From the counter to online payment</span>
            <h2>Every sale, every peso, on record</h2>
            <p>
              Cash or QR Ph, the sale and its payment are saved together in the cloud. Nothing to copy into a notebook,
              nothing to reconcile at night.
            </p>
          </div>

          <div class="row g-5 align-items-center">
            <div class="col-lg-6">
              <ol class="flow">
                <li v-for="(step, i) in onlineSteps" :key="step.title" v-reveal="i * 110" class="flow-step">
                  <span class="flow-icon"><i class="ti" :class="`ti-${step.icon}`"></i></span>
                  <div>
                    <h3><span class="flow-num">{{ i + 1 }}</span>{{ step.title }}</h3>
                    <p>{{ step.text }}</p>
                  </div>
                </li>
              </ol>
            </div>
            <div class="col-lg-6">
              <!-- What the sale looks like once it's paid online -->
              <div v-reveal="150" class="record">
                <div class="record-head">
                  <div>
                    <small>Sale</small>
                    <strong>INV-000142</strong>
                  </div>
                  <span class="badge-paid"><i class="ti ti-circle-check me-1"></i>Paid</span>
                </div>
                <div class="record-lines">
                  <div><span>2 × Coffee 3-in-1</span><span>₱96.00</span></div>
                  <div><span>2 × Bottled water</span><span>₱40.00</span></div>
                  <div><span>1 × Bread loaf</span><span>₱75.00</span></div>
                  <div class="total"><span>Total</span><span>₱211.00</span></div>
                </div>
                <div class="record-payment">
                  <img src="/assets/img/payments/qrph.svg" alt="QR Ph" />
                  <div>
                    <strong>QR Ph · ₱211.00</strong>
                    <small>Ref. 7Q4K-29XH-0142 · via GCash</small>
                  </div>
                </div>
                <ul class="record-log">
                  <li><span class="dot"></span><time>10:42</time>Sale saved by cashier Ana</li>
                  <li><span class="dot"></span><time>10:43</time>QR Ph payment confirmed</li>
                  <li><span class="dot"></span><time>10:43</time>Stock updated for 3 products</li>
                  <li><span class="dot ok"></span><time>10:43</time>₱211.00 added to store wallet</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="promises">
            <div v-for="(item, i) in recordPromises" :key="item.title" v-reveal="i * 80" class="promise">
              <i class="ti" :class="`ti-${item.icon}`"></i>
              <h3>{{ item.title }}</h3>
              <p>{{ item.text }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- A day at the store -->
      <section id="day" class="section section-alt">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">A day at the store</span>
            <h2>From opening to closing, it has your back</h2>
          </div>
          <div class="day">
            <div v-for="(moment, i) in day" :key="moment.time" v-reveal="i * 100" class="moment">
              <div class="moment-time"><i class="ti" :class="`ti-${moment.icon}`"></i>{{ moment.time }}</div>
              <h3>{{ moment.title }}</h3>
              <p>{{ moment.text }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- How it works -->
      <section id="how" class="section">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">How it works</span>
            <h2>Up and running in a day</h2>
            <p>No hardware to buy, no software to install.</p>
          </div>
          <div class="steps">
            <div v-for="(step, i) in steps" :key="step.title" v-reveal="i * 120" class="step">
              <div class="step-num">
                <i class="ti" :class="`ti-${step.icon}`"></i>
                <span>{{ i + 1 }}</span>
              </div>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Pricing -->
      <section id="pricing" class="section section-alt">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">Pricing</span>
            <h2>Simple monthly plans</h2>
            <p>Every plan includes every feature and starts with {{ TRIAL_LABEL }} free. Pick the one that fits your team and catalog.</p>
          </div>

          <div v-if="plansError" class="alert alert-warning text-center mx-auto" style="max-width: 560px">
            {{ plansError }}
          </div>

          <div class="row g-4 justify-content-center align-items-stretch">
            <template v-if="!plans.length && !plansError">
              <div v-for="n in 3" :key="n" class="col-md-6 col-lg-4">
                <div class="plan plan-skeleton"></div>
              </div>
            </template>
            <div v-for="(plan, i) in plans" :key="plan.id" class="col-md-6 col-lg-4">
              <div v-reveal="i * 100" class="plan" :class="{ popular: plan.id === POPULAR_PLAN }">
                <span v-if="plan.id === POPULAR_PLAN" class="popular-badge"><i class="ti ti-sparkles me-1"></i>Most popular</span>
                <h3>{{ plan.name }}</h3>
                <div class="price">
                  <span class="amount">{{ formatPrice(plan.monthlyPrice) }}</span>
                  <span class="per">/ month</span>
                </div>
                <ul class="limits">
                  <li><i class="ti ti-users"></i>{{ describeSeats(plan) }}</li>
                  <li><i class="ti ti-box"></i>Up to {{ number.format(plan.maxProducts) }} products</li>
                  <li><i class="ti ti-qrcode"></i>QR Ph online payments</li>
                  <li><i class="ti ti-circle-check"></i>All features included</li>
                </ul>
                <a
                  :href="googleSignInUrl()"
                  class="btn w-100 mt-auto"
                  :class="plan.id === POPULAR_PLAN ? 'btn-primary btn-glow' : 'btn-outline-primary'"
                >
                  Start free trial<i class="ti ti-arrow-right ms-2 arrow"></i>
                </a>
              </div>
            </div>
          </div>

          <div v-reveal class="included">
            <h4>Included in every plan</h4>
            <ul>
              <li v-for="item in included" :key="item"><i class="ti ti-check"></i>{{ item }}</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section id="faq" class="section">
        <div class="container faq-container">
          <div v-reveal class="section-head">
            <span class="eyebrow">FAQ</span>
            <h2>Questions, answered</h2>
          </div>
          <div v-for="(faq, i) in faqs" :key="faq.q" v-reveal="i * 50" class="faq" :class="{ open: openFaq === i }">
            <button
              type="button"
              class="faq-q"
              :aria-expanded="openFaq === i"
              @click="openFaq = openFaq === i ? null : i"
            >
              {{ faq.q }}<span class="faq-toggle"><i class="ti ti-plus"></i></span>
            </button>
            <div class="faq-a">
              <div><p>{{ faq.a }}</p></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Contact / call to action -->
      <section id="contact" class="cta">
        <div class="cta-bg" aria-hidden="true"></div>
        <div v-reveal class="container text-center position-relative">
          <h2>Ready to run your store?</h2>
          <p>Sign up with Google and start selling today, free for {{ TRIAL_LABEL }}. Questions? Email us.</p>
          <div class="d-flex flex-wrap justify-content-center gap-2">
            <a :href="googleSignInUrl()" class="btn btn-primary btn-lg btn-glow">
              <i class="ti ti-brand-google me-1"></i>Start free trial
            </a>
            <a :href="`mailto:${CONTACT_EMAIL}`" class="btn btn-light btn-lg">
              <i class="ti ti-mail me-1"></i>{{ CONTACT_EMAIL }}
            </a>
            <RouterLink :to="{ name: 'login' }" class="btn btn-light btn-lg">Already a customer? Sign in</RouterLink>
          </div>
        </div>
      </section>
    </main>

    <footer class="landing-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
            <p>Cloud point of sale, barcode scanning and QR Ph payments for Philippine stores.</p>
            <a :href="`mailto:${CONTACT_EMAIL}`"><i class="ti ti-mail me-1"></i>{{ CONTACT_EMAIL }}</a>
          </div>
          <div>
            <h4>Product</h4>
            <a v-for="[id, label] in navLinks" :key="id" :href="`#${id}`" @click.prevent="go(id)">{{ label }}</a>
          </div>
          <div>
            <h4>Get started</h4>
            <a :href="googleSignInUrl()">Start free trial</a>
            <RouterLink :to="{ name: 'login' }">Portal</RouterLink>
          </div>
          <div>
            <h4>Legal</h4>
            <RouterLink v-for="link in legalLinks" :key="link.id" :to="{ name: link.route }">{{ link.label }}</RouterLink>
          </div>
        </div>
        <div class="footer-bottom">Copyright &copy; {{ new Date().getFullYear() }} USystems POS</div>
      </div>
    </footer>

    <Transition name="fade">
      <button v-if="scrollY > 700" type="button" class="to-top" aria-label="Back to top" @click="go('top')">
        <i class="ti ti-arrow-up"></i>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.landing {
  --brand: #fe9f43;
  --brand-dark: #f18a25;
  --brand-soft: rgba(254, 159, 67, 0.12);
  --navy: #092c4c;
  --ink: #212b36;
  --muted: #646b72;
  --line: #e6eaed;
  --alt-bg: #f7f8fa;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  min-height: 100vh;
  background: #fff;
  color: var(--ink);
  overflow-x: clip;
}

.landing section[id] {
  scroll-margin-top: 72px;
}

/* Reveal on scroll */
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}

.reveal.is-visible {
  opacity: 1;
  transform: none;
}

/* Hero entrance */
.hero-in {
  animation: rise 0.8s var(--ease) both;
  animation-delay: var(--d, 0ms);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}

/* Header */
.landing-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid transparent;
  transition:
    box-shadow 0.25s,
    border-color 0.25s,
    background 0.25s;
}

.landing-header.scrolled {
  background: rgba(255, 255, 255, 0.92);
  border-bottom-color: var(--line);
  box-shadow: 0 6px 24px rgba(9, 44, 76, 0.06);
}

.landing-header .container {
  min-height: 68px;
}

/* Thin bar under the header that fills as the page scrolls (where supported) */
.scroll-progress {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, var(--brand), #ffc48a);
  transform-origin: left;
  transform: scaleX(0);
}

@supports (animation-timeline: scroll()) {
  .scroll-progress {
    animation: progress linear both;
    animation-timeline: scroll(root);
  }
}

@keyframes progress {
  to {
    transform: scaleX(1);
  }
}

.brand img {
  height: 40px;
}

.nav-links {
  display: flex;
  gap: 28px;
}

.nav-links a {
  position: relative;
  color: var(--ink);
  font-weight: 500;
  padding: 4px 0;
  transition: color 0.2s;
}

.nav-links a::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  border-radius: 2px;
  background: var(--brand);
  transform: scaleX(0);
  transition: transform 0.3s var(--ease);
}

.nav-links a:hover,
.nav-links a.active {
  color: var(--brand);
}

.nav-links a:hover::after,
.nav-links a.active::after {
  transform: scaleX(1);
}

.menu-toggle {
  display: none;
}

@media (max-width: 767.98px) {
  .menu-toggle {
    display: inline-flex;
  }

  .nav-links {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    flex-direction: column;
    gap: 0;
    background: #fff;
    border-bottom: 1px solid var(--line);
    padding: 8px 16px;
  }

  .nav-links.open {
    display: flex;
    animation: rise 0.3s var(--ease);
  }

  .nav-links a {
    padding: 12px 0;
  }

  .nav-links a::after {
    display: none;
  }

  .nav-links a + a {
    border-top: 1px solid var(--line);
  }
}

/* Buttons */
.btn-glow {
  box-shadow: 0 8px 20px rgba(254, 159, 67, 0.35);
  transition:
    transform 0.2s var(--ease),
    box-shadow 0.2s;
}

.btn-glow:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(254, 159, 67, 0.45);
}

.btn .arrow {
  display: inline-block;
  transition: transform 0.2s var(--ease);
}

.btn:hover .arrow {
  transform: translateX(4px);
}

/* Shared */
.eyebrow {
  display: inline-block;
  color: var(--brand);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 12px;
}

.section {
  padding: 96px 0;
}

.section-alt {
  background: var(--alt-bg);
}

.section-head {
  text-align: center;
  max-width: 620px;
  margin: 0 auto 52px;
}

.section-head h2 {
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 12px;
}

.section-head p {
  color: var(--muted);
  font-size: 17px;
  margin: 0;
}

/* Hero */
.hero {
  position: relative;
  padding: 80px 0 104px;
  background: linear-gradient(180deg, #fff7ef 0%, #fff 100%);
  overflow: hidden;
}

.hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.55;
}

.blob-1 {
  width: 460px;
  height: 460px;
  background: #ffd3a6;
  top: -140px;
  right: -80px;
  animation: drift 16s ease-in-out infinite alternate;
}

.blob-2 {
  width: 360px;
  height: 360px;
  background: #cfe0f2;
  bottom: -160px;
  left: -100px;
  animation: drift 20s ease-in-out infinite alternate-reverse;
}

@keyframes drift {
  to {
    transform: translate(-60px, 50px) scale(1.12);
  }
}

.grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(9, 44, 76, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(9, 44, 76, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse at 70% 30%, #000 0%, transparent 65%);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #ffe0c2;
  color: var(--brand-dark);
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(254, 159, 67, 0.1);
}

.pill-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 0 0 rgba(254, 159, 67, 0.6);
  animation: ping 2s infinite;
}

@keyframes ping {
  70% {
    box-shadow: 0 0 0 8px rgba(254, 159, 67, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(254, 159, 67, 0);
  }
}

.hero h1 {
  font-size: clamp(32px, 5vw, 52px);
  line-height: 1.12;
  font-weight: 800;
  color: var(--navy);
  margin-bottom: 20px;
  letter-spacing: -0.01em;
}

.highlight {
  background: linear-gradient(90deg, var(--brand-dark), var(--brand), #ffb46b, var(--brand-dark));
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: sheen 8s linear infinite;
}

@keyframes sheen {
  to {
    background-position: 300% 0;
  }
}

.lead-text {
  font-size: 18px;
  color: var(--muted);
  margin-bottom: 32px;
  max-width: 520px;
}

.hero-points {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  color: var(--muted);
  font-size: 14px;
}

.hero-points i {
  color: #28a745;
  margin-right: 6px;
}

/* POS demo */
.mock-wrap {
  position: relative;
  padding: 28px 0;
}

.mock {
  position: relative;
  z-index: 1;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 30px 60px rgba(9, 44, 76, 0.14);
  overflow: hidden;
}

.mock-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: var(--navy);
}

.mock-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
}

.mock-bar em {
  margin-left: auto;
  font-style: normal;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.mock-body {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  padding: 16px;
}

.mock-products {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  align-content: start;
}

.mock-product {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 10px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s var(--ease);
}

.mock-product:hover {
  border-color: var(--brand);
  box-shadow: 0 8px 18px rgba(254, 159, 67, 0.18);
  transform: translateY(-2px);
}

.mock-product:active {
  transform: scale(0.97);
}

.mock-product.bump {
  animation: bump 0.4s var(--ease);
}

@keyframes bump {
  40% {
    transform: scale(0.94);
    background: var(--brand-soft);
  }
}

.mock-product > i {
  font-size: 24px;
  color: var(--brand);
  margin-bottom: 6px;
}

.mock-product .name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
}

.mock-product .price {
  font-size: 12px;
  color: var(--muted);
}

.mock-product .add {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--brand);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity 0.2s,
    transform 0.2s var(--ease);
}

.mock-product:hover .add {
  opacity: 1;
  transform: none;
}

.mock-cart {
  background: var(--alt-bg);
  border-radius: 10px;
  padding: 14px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  min-height: 250px;
}

.mock-lines {
  position: relative;
  flex: 1;
}

.mock-row,
.mock-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 0;
}

.qty-btn {
  flex: none;
  width: 18px;
  height: 18px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #fff;
  color: var(--muted);
  font-size: 11px;
  display: grid;
  place-items: center;
  padding: 0;
  transition:
    color 0.2s,
    border-color 0.2s;
}

.qty-btn:hover {
  color: #dc3545;
  border-color: #dc3545;
}

.mock-empty {
  color: var(--muted);
  font-size: 12px;
  padding: 12px 0;
}

.line-enter-active,
.line-leave-active {
  transition: all 0.3s var(--ease);
}

.line-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.line-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.line-leave-active {
  position: absolute;
  left: 0;
  right: 0;
}

.mock-total {
  border-top: 1px dashed #c7ccd1;
  margin-top: 8px;
  padding-top: 10px;
  font-weight: 700;
  font-size: 15px;
  color: var(--navy);
}

.mock-pay {
  margin-top: 10px;
  background: var(--brand);
  border: 0;
  color: #fff;
  text-align: center;
  font-weight: 700;
  border-radius: 8px;
  padding: 9px;
  transition:
    background 0.25s,
    transform 0.15s;
}

.mock-pay:hover:not(:disabled) {
  background: var(--brand-dark);
}

.mock-pay:active:not(:disabled) {
  transform: scale(0.98);
}

.mock-pay:disabled {
  opacity: 0.5;
  cursor: default;
}

.mock-pay.paid {
  background: #28a745;
  opacity: 1;
}

.float-chip {
  position: absolute;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 14px 30px rgba(9, 44, 76, 0.12);
  font-size: 13px;
  animation: float 5s ease-in-out infinite;
}

.float-chip small {
  display: block;
  color: var(--muted);
  font-size: 11px;
}

.float-chip strong {
  color: var(--navy);
  font-variant-numeric: tabular-nums;
}

.chip-sales {
  top: -6px;
  left: -28px;
}

.chip-stock {
  bottom: -4px;
  right: -20px;
  animation-delay: -2.5s;
}

.chip-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 18px;
}

.chip-icon.green {
  background: rgba(40, 167, 69, 0.12);
  color: #28a745;
}

.chip-icon.amber {
  background: var(--brand-soft);
  color: var(--brand-dark);
}

@keyframes float {
  50% {
    transform: translateY(-8px);
  }
}

@media (max-width: 991.98px) {
  .chip-sales {
    left: 0;
  }

  .chip-stock {
    right: 0;
  }
}

@media (max-width: 575.98px) {
  .mock-body {
    grid-template-columns: 1fr;
  }

  .mock-cart {
    min-height: 0;
  }

  .float-chip {
    display: none;
  }

  .mock-wrap {
    padding: 0;
  }
}

/* Features */
.feature {
  position: relative;
  height: 100%;
  padding: 28px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  transition:
    box-shadow 0.3s,
    border-color 0.3s,
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}

.feature::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(260px circle at var(--mx, 50%) var(--my, 0%), rgba(254, 159, 67, 0.12), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.feature:hover {
  border-color: #ffd9b3;
  box-shadow: 0 18px 36px rgba(9, 44, 76, 0.08);
}

.feature.is-visible:hover {
  transform: translateY(-4px);
}

.feature:hover::before {
  opacity: 1;
}

.feature-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 24px;
  margin-bottom: 16px;
  transition:
    background 0.3s,
    color 0.3s,
    transform 0.3s var(--ease);
}

.feature:hover .feature-icon {
  background: var(--brand);
  color: #fff;
  transform: rotate(-6deg) scale(1.05);
}

.feature h3 {
  position: relative;
  font-size: 18px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 8px;
}

.feature p {
  position: relative;
  color: var(--muted);
  margin: 0;
}

/* How it works */
.steps {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
}

.steps::before {
  content: '';
  position: absolute;
  top: 32px;
  left: 16.6%;
  right: 16.6%;
  border-top: 2px dashed #f3c99f;
}

.step {
  position: relative;
  text-align: center;
  padding: 0 12px;
}

.step-num {
  position: relative;
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--brand);
  color: var(--brand);
  font-size: 26px;
  display: grid;
  place-items: center;
  box-shadow: 0 0 0 8px #fff;
  transition:
    background 0.3s,
    color 0.3s,
    transform 0.3s var(--ease);
}

.step:hover .step-num {
  background: var(--brand);
  color: #fff;
  transform: scale(1.06);
}

.step-num span {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--navy);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.step h3 {
  font-size: 18px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 8px;
}

.step p {
  color: var(--muted);
  margin: 0 auto;
  max-width: 300px;
}

@media (max-width: 767.98px) {
  .steps {
    grid-template-columns: 1fr;
  }

  .steps::before {
    display: none;
  }
}

/* Pricing */
.plan {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 32px 28px;
  transition:
    box-shadow 0.3s,
    border-color 0.3s,
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}

.plan.is-visible:hover {
  transform: translateY(-6px);
  box-shadow: 0 24px 48px rgba(9, 44, 76, 0.1);
}

.plan.popular {
  border: 2px solid var(--brand);
  background: linear-gradient(180deg, #fffaf4 0%, #fff 40%);
  box-shadow: 0 24px 48px rgba(254, 159, 67, 0.18);
}

.plan.popular.is-visible:hover {
  box-shadow: 0 30px 60px rgba(254, 159, 67, 0.26);
}

.plan-skeleton {
  min-height: 340px;
  background: linear-gradient(90deg, #fff 0%, #f1f3f5 50%, #fff 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite linear;
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

.popular-badge {
  position: absolute;
  top: -13px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--brand);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 14px;
  border-radius: 999px;
  white-space: nowrap;
  box-shadow: 0 6px 14px rgba(254, 159, 67, 0.35);
}

.plan h3 {
  font-size: 20px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 12px;
}

.price {
  margin-bottom: 24px;
}

.price .amount {
  font-size: 44px;
  font-weight: 800;
  color: var(--navy);
  line-height: 1;
}

.price .per {
  color: var(--muted);
  margin-left: 4px;
}

.limits {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
}

.limits li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}

.limits i {
  color: var(--brand);
  font-size: 18px;
}

.included {
  margin: 56px auto 0;
  max-width: 820px;
  text-align: center;
}

.included h4 {
  font-size: 17px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 16px;
}

.included ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.included li {
  color: var(--ink);
  background: var(--alt-bg);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 14px;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.included li:hover {
  border-color: #b7e4c2;
  background: #f0faf3;
}

.included i {
  color: #28a745;
  margin-right: 6px;
}

/* FAQ */
.faq-container {
  max-width: 760px;
}

.faq {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-bottom: 12px;
  transition:
    border-color 0.25s,
    box-shadow 0.25s,
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}

.faq.open {
  border-color: #ffd9b3;
  box-shadow: 0 10px 24px rgba(9, 44, 76, 0.06);
}

.faq-q {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  background: none;
  border: 0;
  text-align: left;
  font-weight: 600;
  font-size: 17px;
  color: var(--navy);
}

.faq-toggle {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--alt-bg);
  color: var(--muted);
  transition:
    transform 0.3s var(--ease),
    background 0.3s,
    color 0.3s;
}

.faq.open .faq-toggle {
  transform: rotate(45deg);
  background: var(--brand);
  color: #fff;
}

.faq-a {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s var(--ease);
}

.faq.open .faq-a {
  grid-template-rows: 1fr;
}

.faq-a > div {
  overflow: hidden;
}

.faq-a p {
  color: var(--muted);
  margin: 0;
  padding: 0 22px 20px;
}

/* Call to action */
.cta {
  position: relative;
  padding: 96px 0;
  background: var(--navy);
  color: #fff;
  overflow: hidden;
}

.cta-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(500px circle at 15% 20%, rgba(254, 159, 67, 0.22), transparent 60%),
    radial-gradient(400px circle at 85% 90%, rgba(80, 140, 200, 0.25), transparent 60%);
}

.cta-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 22px 22px;
}

.cta h2 {
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 700;
  color: #fff;
  margin-bottom: 12px;
}

.cta p {
  color: rgba(255, 255, 255, 0.75);
  font-size: 17px;
  margin-bottom: 28px;
}

/* Footer */
.landing-footer {
  padding: 24px 0;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
}

.landing-footer a {
  color: var(--muted);
}


.landing-footer a:hover {
  color: var(--brand);
}

/* Back to top */
.to-top {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--navy);
  color: #fff;
  font-size: 20px;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 24px rgba(9, 44, 76, 0.25);
  transition:
    transform 0.2s var(--ease),
    background 0.2s;
}

.to-top:hover {
  background: var(--brand);
  transform: translateY(-3px);
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s var(--ease);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Header trial button: room for it only on wider screens */
@media (max-width: 575.98px) {
  .header-trial {
    display: none;
  }
}

/* Hero payment logos */
.hero-logos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-top: 24px;
  color: var(--muted);
  font-size: 13px;
}

.hero-logos img {
  height: 22px;
  width: auto;
}

/* POS demo: search bar, scanner, QR Ph */
.mock-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mock-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 4px 4px 4px 10px;
  color: var(--muted);
  font-size: 12px;
}

.mock-search span {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mock-scan {
  border: 0;
  border-radius: 6px;
  background: var(--navy);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  transition: background 0.2s;
}

.mock-scan:hover:not(:disabled) {
  background: var(--brand);
}

.mock-scan:disabled {
  opacity: 0.6;
}

.mock-products {
  position: relative;
}

.laser {
  position: absolute;
  left: -4px;
  right: -4px;
  top: 0;
  height: 2px;
  z-index: 2;
  background: #ff3b30;
  box-shadow: 0 0 10px 2px rgba(255, 59, 48, 0.6);
  opacity: 0;
  pointer-events: none;
}

.mock-products.scanning .laser {
  animation: laser 0.75s ease-in-out;
}

@keyframes laser {
  0% {
    opacity: 1;
    top: 0;
  }
  50% {
    top: calc(100% - 2px);
  }
  100% {
    opacity: 1;
    top: 0;
  }
}

.mock-bar em.beep {
  color: #7ee2a0;
}

.mock-pay-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mock-pay.qr {
  background: var(--navy);
}

.mock-pay.qr:hover:not(:disabled) {
  background: #0d3d69;
}

.mock-pay.waiting {
  background: var(--navy);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mock-pay.paid {
  font-size: 12px;
}

.mock-qr {
  position: absolute;
  inset: 40px 0 0;
  z-index: 3;
  display: grid;
  place-items: center;
  background: rgba(9, 44, 76, 0.55);
  backdrop-filter: blur(2px);
}

.mock-qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: #fff;
  border-radius: 14px;
  padding: 16px 22px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  animation: rise 0.35s var(--ease);
}

.qr-brand {
  height: 20px;
}

.qr-code {
  width: 120px;
  height: 120px;
}

.qr-code :deep(svg) {
  width: 100%;
  height: 100%;
}

.mock-qr-card strong {
  color: var(--navy);
  font-size: 14px;
}

.mock-qr-card small {
  color: var(--muted);
  font-size: 11px;
}

.chip-icon.blue {
  background: rgba(13, 110, 253, 0.1);
  color: #0d6efd;
}

/* Who it's for */
.section-tight {
  padding: 80px 0;
}

.stores {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.store-card {
  display: flex;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fff;
  transition:
    border-color 0.3s,
    box-shadow 0.3s,
    opacity 0.7s var(--ease),
    transform 0.7s var(--ease);
}

.store-card:hover {
  border-color: #ffd9b3;
  box-shadow: 0 14px 30px rgba(9, 44, 76, 0.07);
}

.store-icon {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--navy);
  color: #fff;
  font-size: 22px;
}

.store-card h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 4px;
}

.store-card p {
  color: var(--muted);
  font-size: 14px;
  margin: 0;
}

@media (max-width: 991.98px) {
  .stores {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 575.98px) {
  .stores {
    grid-template-columns: 1fr;
  }
}

/* POS to online payment */
.online {
  background: linear-gradient(180deg, #fff 0%, #fff7ef 100%);
}

.flow {
  list-style: none;
  padding: 0;
  margin: 0;
  position: relative;
}

.flow::before {
  content: '';
  position: absolute;
  left: 23px;
  top: 24px;
  bottom: 24px;
  border-left: 2px dashed #f3c99f;
}

.flow-step {
  position: relative;
  display: flex;
  gap: 18px;
  padding: 0 0 26px;
}

.flow-step:last-child {
  padding-bottom: 0;
}

.flow-icon {
  position: relative;
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--brand);
  color: #fff;
  font-size: 22px;
  box-shadow: 0 8px 18px rgba(254, 159, 67, 0.3);
}

.flow-step h3 {
  font-size: 18px;
  font-weight: 700;
  color: var(--navy);
  margin: 4px 0 4px;
}

.flow-num {
  color: var(--brand);
  margin-right: 8px;
}

.flow-step p {
  color: var(--muted);
  margin: 0;
}

.record {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 30px 60px rgba(9, 44, 76, 0.12);
  max-width: 460px;
  margin: 0 auto;
}

.record-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.record-head small {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.record-head strong {
  color: var(--navy);
  font-size: 18px;
}

.badge-paid {
  background: rgba(40, 167, 69, 0.12);
  color: #28a745;
  font-weight: 700;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 999px;
}

.record-lines {
  padding: 12px 0;
  font-size: 14px;
}

.record-lines div {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.record-lines .total {
  border-top: 1px dashed #c7ccd1;
  margin-top: 6px;
  padding-top: 8px;
  font-weight: 700;
  color: var(--navy);
}

.record-payment {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--alt-bg);
  border-radius: 12px;
  padding: 12px 14px;
}

.record-payment img {
  height: 26px;
}

.record-payment strong {
  display: block;
  color: var(--navy);
  font-size: 14px;
}

.record-payment small {
  color: var(--muted);
  font-size: 12px;
}

.record-log {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--ink);
}

.record-log li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}

.record-log time {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  width: 40px;
}

.record-log .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  flex: none;
}

.record-log .dot.ok {
  background: #28a745;
}

.promises {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 64px;
}

.promise {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 22px;
}

.promise i {
  font-size: 26px;
  color: #28a745;
}

.promise h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--navy);
  margin: 10px 0 6px;
}

.promise p {
  color: var(--muted);
  font-size: 14px;
  margin: 0;
}

@media (max-width: 991.98px) {
  .promises {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 575.98px) {
  .promises {
    grid-template-columns: 1fr;
  }

  .record {
    padding: 18px;
  }
}

/* A day at the store */
.day {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.moment {
  position: relative;
  background: #fff;
  border: 1px solid var(--line);
  border-top: 4px solid var(--brand);
  border-radius: 14px;
  padding: 22px;
}

.moment-time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13px;
  color: var(--brand-dark);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 12px;
  margin-bottom: 14px;
}

.moment h3 {
  font-size: 17px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 6px;
}

.moment p {
  color: var(--muted);
  font-size: 14px;
  margin: 0;
}

@media (max-width: 991.98px) {
  .day {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 575.98px) {
  .day {
    grid-template-columns: 1fr;
  }
}

/* Footer columns */
.footer-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 32px;
  padding: 24px 0 32px;
}

.footer-grid h4 {
  font-size: 14px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 12px;
}

.footer-grid > div:not(.footer-brand) a {
  display: block;
  padding: 3px 0;
}

.footer-brand img {
  height: 36px;
  margin-bottom: 12px;
}

.footer-brand p {
  max-width: 320px;
  margin-bottom: 10px;
}

.footer-bottom {
  border-top: 1px solid var(--line);
  padding-top: 20px;
}

@media (max-width: 767.98px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
  }

  .footer-brand {
    grid-column: 1 / -1;
  }
}

/* Respect visitors who turn off motion */
@media (prefers-reduced-motion: reduce) {
  .landing *,
  .landing *::before,
  .landing *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0s !important;
  }

  .reveal {
    opacity: 1;
    transform: none;
  }
}
</style>
