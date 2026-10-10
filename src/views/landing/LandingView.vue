<script setup lang="ts">
// Public one-page site: what USystems POS does, the plans and their prices (from /api/plans,
// so they always match the real limits), and the Portal button that opens the login page.
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue'
import { describeSeats, formatPrice, getPlans, type Plan } from '@/api/subscription'
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

const sections = ['features', 'how', 'pricing', 'faq', 'contact']

const features = [
  {
    icon: 'device-desktop-dollar',
    title: 'Fast point of sale',
    text: 'Ring up sales in seconds with product search, barcode scanning, discounts and change computation.',
  },
  {
    icon: 'packages',
    title: 'Inventory that keeps up',
    text: 'Track stock per product and variant, adjust counts, and get alerts for low stock and expiring items.',
  },
  {
    icon: 'barcode',
    title: 'Barcode & QR labels',
    text: 'Print barcode and QR code labels for your shelves straight from your product list.',
  },
  {
    icon: 'file-invoice',
    title: 'Sales, invoices & returns',
    text: 'Every sale is recorded with its invoice. Handle returns cleanly and keep your records accurate.',
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

const steps = [
  { icon: 'mail', title: 'Tell us about your store', text: 'Pick a plan and send us a message. We set up your store account for you.' },
  { icon: 'packages', title: 'Add your products', text: 'Enter your catalog, set prices and stock, and print labels for your shelves.' },
  { icon: 'building-store', title: 'Start selling', text: 'Open the POS on any browser and ring up your first sale the same day.' },
]

const included = [
  'Point of sale',
  'Products, variants & warranties',
  'Stock adjustments & alerts',
  'Barcode & QR label printing',
  'Sales, invoices & returns',
  'Quotations',
  'Customers & suppliers',
  'Roles & permissions',
]

const faqs = [
  {
    q: 'Do I need to install anything?',
    a: 'No. USystems POS runs in your web browser, so it works on the computers, laptops and tablets you already have.',
  },
  {
    q: 'How does billing work?',
    a: 'Plans are billed monthly. You renew from the Subscription page inside the portal, and your store is extended by a month once payment is confirmed.',
  },
  {
    q: 'What happens if my subscription expires?',
    a: 'Nothing is deleted. Your store becomes view-only until you renew, so you can still look up your sales and products.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Choose another plan when you renew and your store switches to it as soon as the renewal is paid.',
  },
]
const openFaq = ref<number | null>(0)

function go(id: string) {
  menuOpen.value = false
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

// --- Hero demo: a tiny working POS visitors can click ---

const demoProducts = [
  { name: 'Coffee 3-in-1', price: 48, icon: 'coffee' },
  { name: 'Bottled water', price: 20, icon: 'bottle' },
  { name: 'Bread loaf', price: 75, icon: 'bread' },
  { name: 'Fresh milk', price: 95, icon: 'milk' },
  { name: 'Apples (1kg)', price: 160, icon: 'apple' },
  { name: 'Cookies', price: 35, icon: 'cookie' },
]
const startingCart = () => ({ 'Coffee 3-in-1': 2, 'Bottled water': 2, 'Bread loaf': 1 }) as Record<string, number>

const cart = ref<Record<string, number>>(startingCart())
const cartLines = computed(() =>
  demoProducts.filter((p) => cart.value[p.name]).map((p) => ({ ...p, qty: cart.value[p.name]! })),
)
const cartTotal = computed(() => cartLines.value.reduce((sum, line) => sum + line.price * line.qty, 0))
const lastAdded = ref('')
const paid = ref(false)
const todaySales = ref(12480)
const shownSales = ref(todaySales.value)
const timers: number[] = []

function addToCart(name: string) {
  if (paid.value) return
  cart.value = { ...cart.value, [name]: (cart.value[name] ?? 0) + 1 }
  lastAdded.value = name
  timers.push(window.setTimeout(() => lastAdded.value === name && (lastAdded.value = ''), 400))
}

function removeFromCart(name: string) {
  if (paid.value) return
  const qty = (cart.value[name] ?? 0) - 1
  const next = { ...cart.value }
  if (qty > 0) next[name] = qty
  else delete next[name]
  cart.value = next
}

function pay() {
  if (paid.value || !cartTotal.value) return
  paid.value = true
  countTo(todaySales.value + cartTotal.value)
  timers.push(
    window.setTimeout(() => {
      cart.value = {}
      paid.value = false
    }, 2200),
  )
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
            v-for="[id, label] in [['features', 'Features'], ['pricing', 'Pricing'], ['faq', 'FAQ'], ['contact', 'Contact']]"
            :key="id"
            :href="`#${id}`"
            :class="{ active: activeSection === id }"
            @click.prevent="go(id!)"
          >
            {{ label }}
          </a>
        </nav>
        <div class="d-flex align-items-center gap-2">
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
                <span class="pill-dot"></span>Point of sale for growing stores
              </span>
              <h1 class="hero-in" style="--d: 80ms">
                Sell faster. Know your stock. <span class="highlight">Run your store from anywhere.</span>
              </h1>
              <p class="lead-text hero-in" style="--d: 160ms">
                USystems POS brings your counter, inventory, invoices and team into one simple system that runs
                in your browser.
              </p>
              <div class="d-flex flex-wrap gap-2 hero-in" style="--d: 240ms">
                <a href="#pricing" class="btn btn-primary btn-lg btn-glow" @click.prevent="go('pricing')">
                  See pricing<i class="ti ti-arrow-right ms-2 arrow"></i>
                </a>
                <a :href="googleSignInUrl()" class="btn btn-outline-dark btn-lg">
                  <i class="ti ti-brand-google me-1"></i>Start free trial
                </a>
              </div>
              <ul class="hero-points hero-in" style="--d: 320ms">
                <li><i class="ti ti-circle-check"></i>Nothing to install</li>
                <li><i class="ti ti-circle-check"></i>All features in every plan</li>
                <li><i class="ti ti-circle-check"></i>Monthly billing</li>
              </ul>
            </div>
            <div class="col-lg-6">
              <!-- A small working POS: click products to add them, then Pay -->
              <div class="mock-wrap hero-in" style="--d: 200ms">
                <div class="float-chip chip-sales">
                  <span class="chip-icon green"><i class="ti ti-trending-up"></i></span>
                  <div>
                    <small>Today's sales</small>
                    <strong>{{ formatPrice(shownSales) }}</strong>
                  </div>
                </div>
                <div class="float-chip chip-stock">
                  <span class="chip-icon amber"><i class="ti ti-bell-ringing"></i></span>
                  <div>
                    <small>Low stock</small>
                    <strong>Fresh milk · 4 left</strong>
                  </div>
                </div>

                <div class="mock">
                  <div class="mock-bar">
                    <span></span><span></span><span></span>
                    <em>Try it — tap a product</em>
                  </div>
                  <div class="mock-body">
                    <div class="mock-products">
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
                        <div v-if="!cartLines.length && !paid" class="mock-empty">Tap a product to add it</div>
                      </div>
                      <div class="mock-total">
                        <span>Total</span><span>{{ formatPrice(cartTotal) }}</span>
                      </div>
                      <button type="button" class="mock-pay" :class="{ paid }" :disabled="!cartTotal && !paid" @click="pay">
                        <template v-if="paid"><i class="ti ti-check me-1"></i>Sale recorded</template>
                        <template v-else>Pay {{ formatPrice(cartTotal) }}</template>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Features -->
      <section id="features" class="section">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">Features</span>
            <h2>Everything your counter needs</h2>
            <p>Built for sari-sari stores, groceries, hardware shops and retailers of every size.</p>
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

      <!-- How it works -->
      <section id="how" class="section section-alt">
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
      <section id="pricing" class="section">
        <div class="container">
          <div v-reveal class="section-head">
            <span class="eyebrow">Pricing</span>
            <h2>Simple monthly plans</h2>
            <p>Every plan includes every feature. Pick the one that fits your team and catalog.</p>
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
                  <li><i class="ti ti-circle-check"></i>All features included</li>
                </ul>
                <a
                  :href="`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`USystems POS ${plan.name} plan`)}`"
                  class="btn w-100 mt-auto"
                  :class="plan.id === POPULAR_PLAN ? 'btn-primary btn-glow' : 'btn-outline-primary'"
                >
                  Get started<i class="ti ti-arrow-right ms-2 arrow"></i>
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
      <section id="faq" class="section section-alt">
        <div class="container faq-container">
          <div v-reveal class="section-head">
            <span class="eyebrow">FAQ</span>
            <h2>Questions, answered</h2>
          </div>
          <div v-for="(faq, i) in faqs" :key="faq.q" v-reveal="i * 70" class="faq" :class="{ open: openFaq === i }">
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
          <h2>Ready to set up your store?</h2>
          <p>Sign up with Google and start selling today, free for 14 days. Questions? Email us.</p>
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
      <div class="container d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span>Copyright &copy; {{ new Date().getFullYear() }} USystems POS</span>
        <nav class="footer-links">
          <RouterLink v-for="link in legalLinks" :key="link.id" :to="{ name: link.route }">{{ link.label }}</RouterLink>
          <RouterLink :to="{ name: 'login' }">Portal</RouterLink>
        </nav>
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
  box-shadow: 0 0 0 8px var(--alt-bg);
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

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
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
