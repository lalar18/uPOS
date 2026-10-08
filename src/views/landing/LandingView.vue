<script setup lang="ts">
// Public one-page site: what USystems POS does, the plans and their prices (from /api/plans,
// so they always match the real limits), and the Portal button that opens the login page.
import { ref } from 'vue'
import { describeSeats, formatPrice, getPlans, type Plan } from '@/api/subscription'

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
    a: "Nothing is deleted. Your store becomes view-only until you renew, so you can still look up your sales and products.",
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Choose another plan when you renew and your store switches to it as soon as the renewal is paid.',
  },
]

function go(id: string) {
  menuOpen.value = false
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div class="landing">
    <!-- Header -->
    <header class="landing-header">
      <div class="container d-flex align-items-center justify-content-between gap-3">
        <a href="#top" class="brand" @click.prevent="go('top')">
          <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
        </a>
        <nav class="nav-links" :class="{ open: menuOpen }">
          <a href="#features" @click.prevent="go('features')">Features</a>
          <a href="#pricing" @click.prevent="go('pricing')">Pricing</a>
          <a href="#faq" @click.prevent="go('faq')">FAQ</a>
          <a href="#contact" @click.prevent="go('contact')">Contact</a>
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
    </header>

    <main>
      <!-- Hero -->
      <section id="top" class="hero">
        <div class="container">
          <div class="row align-items-center g-5">
            <div class="col-lg-6">
              <span class="eyebrow">Point of sale for growing stores</span>
              <h1>Sell faster. Know your stock. Run your store from anywhere.</h1>
              <p class="lead-text">
                USystems POS brings your counter, inventory, invoices and team into one simple system that runs
                in your browser.
              </p>
              <div class="d-flex flex-wrap gap-2">
                <a href="#pricing" class="btn btn-primary btn-lg" @click.prevent="go('pricing')">See pricing</a>
                <RouterLink :to="{ name: 'login' }" class="btn btn-outline-dark btn-lg">Sign in to portal</RouterLink>
              </div>
            </div>
            <div class="col-lg-6">
              <!-- Illustration of the POS screen -->
              <div class="mock" aria-hidden="true">
                <div class="mock-bar"><span></span><span></span><span></span></div>
                <div class="mock-body">
                  <div class="mock-products">
                    <div v-for="n in 6" :key="n" class="mock-product">
                      <i class="ti" :class="['ti-bottle', 'ti-cookie', 'ti-coffee', 'ti-apple', 'ti-milk', 'ti-candy'][n - 1]"></i>
                      <div class="line w-75"></div>
                      <div class="line short"></div>
                    </div>
                  </div>
                  <div class="mock-cart">
                    <div class="fw-semibold mb-2">Current sale</div>
                    <div v-for="item in [['Coffee 3-in-1', '₱96'], ['Bottled water', '₱40'], ['Bread loaf', '₱75']]" :key="item[0]" class="mock-row">
                      <span>{{ item[0] }}</span><span>{{ item[1] }}</span>
                    </div>
                    <div class="mock-total"><span>Total</span><span>₱211</span></div>
                    <div class="mock-pay">Pay</div>
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
          <div class="section-head">
            <span class="eyebrow">Features</span>
            <h2>Everything your counter needs</h2>
            <p>Built for sari-sari stores, groceries, hardware shops and retailers of every size.</p>
          </div>
          <div class="row g-4">
            <div v-for="feature in features" :key="feature.title" class="col-md-6 col-lg-4">
              <div class="feature">
                <span class="feature-icon"><i class="ti" :class="`ti-${feature.icon}`"></i></span>
                <h3>{{ feature.title }}</h3>
                <p>{{ feature.text }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Pricing -->
      <section id="pricing" class="section section-alt">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow">Pricing</span>
            <h2>Simple monthly plans</h2>
            <p>Every plan includes every feature. Pick the one that fits your team and catalog.</p>
          </div>

          <div v-if="plansError" class="alert alert-warning text-center mx-auto" style="max-width: 560px">
            {{ plansError }}
          </div>

          <div class="row g-4 justify-content-center">
            <template v-if="!plans.length && !plansError">
              <div v-for="n in 3" :key="n" class="col-md-6 col-lg-4">
                <div class="plan plan-skeleton"></div>
              </div>
            </template>
            <div v-for="plan in plans" :key="plan.id" class="col-md-6 col-lg-4">
              <div class="plan" :class="{ popular: plan.id === POPULAR_PLAN }">
                <span v-if="plan.id === POPULAR_PLAN" class="popular-badge">Most popular</span>
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
                  :class="plan.id === POPULAR_PLAN ? 'btn-primary' : 'btn-outline-primary'"
                >
                  Get started
                </a>
              </div>
            </div>
          </div>

          <div class="included">
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
          <div class="section-head">
            <span class="eyebrow">FAQ</span>
            <h2>Questions, answered</h2>
          </div>
          <details v-for="faq in faqs" :key="faq.q" class="faq">
            <summary>{{ faq.q }}<i class="ti ti-chevron-down"></i></summary>
            <p>{{ faq.a }}</p>
          </details>
        </div>
      </section>

      <!-- Contact / call to action -->
      <section id="contact" class="cta">
        <div class="container text-center">
          <h2>Ready to set up your store?</h2>
          <p>Tell us about your business and we'll get your store account ready.</p>
          <div class="d-flex flex-wrap justify-content-center gap-2">
            <a :href="`mailto:${CONTACT_EMAIL}`" class="btn btn-primary btn-lg">
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
        <RouterLink :to="{ name: 'login' }">Portal</RouterLink>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  --brand: #fe9f43;
  --brand-soft: rgba(254, 159, 67, 0.12);
  --navy: #092c4c;
  --ink: #212b36;
  --muted: #646b72;
  --line: #e6eaed;
  --alt-bg: #f7f8fa;

  min-height: 100vh;
  background: #fff;
  color: var(--ink);
}

.landing section[id] {
  scroll-margin-top: 72px;
}

/* Header */
.landing-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}

.landing-header .container {
  min-height: 68px;
}

.brand img {
  height: 40px;
}

.nav-links {
  display: flex;
  gap: 28px;
}

.nav-links a {
  color: var(--ink);
  font-weight: 500;
}

.nav-links a:hover {
  color: var(--brand);
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
  }

  .nav-links a {
    padding: 12px 0;
  }

  .nav-links a + a {
    border-top: 1px solid var(--line);
  }
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
  padding: 88px 0;
}

.section-alt {
  background: var(--alt-bg);
}

.section-head {
  text-align: center;
  max-width: 620px;
  margin: 0 auto 48px;
}

.section-head h2 {
  font-size: clamp(26px, 4vw, 36px);
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
  padding: 80px 0 96px;
  background: linear-gradient(180deg, #fff7ef 0%, #fff 100%);
}

.hero h1 {
  font-size: clamp(32px, 5vw, 50px);
  line-height: 1.15;
  font-weight: 800;
  color: var(--navy);
  margin-bottom: 20px;
}

.lead-text {
  font-size: 18px;
  color: var(--muted);
  margin-bottom: 32px;
  max-width: 520px;
}

/* POS illustration */
.mock {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 30px 60px rgba(9, 44, 76, 0.12);
  overflow: hidden;
}

.mock-bar {
  display: flex;
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
}

.mock-product {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 10px;
}

.mock-product i {
  font-size: 24px;
  color: var(--brand);
  display: block;
  margin-bottom: 8px;
}

.line {
  height: 6px;
  border-radius: 3px;
  background: var(--line);
  margin-top: 6px;
}

.line.short {
  width: 40%;
}

.mock-cart {
  background: var(--alt-bg);
  border-radius: 10px;
  padding: 14px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
}

.mock-row,
.mock-total {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}

.mock-total {
  border-top: 1px dashed #c7ccd1;
  margin-top: auto;
  padding-top: 10px;
  font-weight: 700;
  font-size: 15px;
  color: var(--navy);
}

.mock-pay {
  margin-top: 10px;
  background: var(--brand);
  color: #fff;
  text-align: center;
  font-weight: 700;
  border-radius: 8px;
  padding: 8px;
}

@media (max-width: 575.98px) {
  .mock-body {
    grid-template-columns: 1fr;
  }
}

/* Features */
.feature {
  height: 100%;
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 14px;
  transition: box-shadow 0.2s, transform 0.2s;
}

.feature:hover {
  box-shadow: 0 16px 32px rgba(9, 44, 76, 0.08);
  transform: translateY(-2px);
}

.feature-icon {
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
}

.feature h3 {
  font-size: 18px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 8px;
}

.feature p {
  color: var(--muted);
  margin: 0;
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
}

.plan.popular {
  border: 2px solid var(--brand);
  box-shadow: 0 24px 48px rgba(254, 159, 67, 0.18);
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
  gap: 10px 24px;
}

.included li {
  color: var(--muted);
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
  border-bottom: 1px solid var(--line);
}

.faq summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
  font-weight: 600;
  font-size: 17px;
  color: var(--navy);
  cursor: pointer;
  list-style: none;
}

.faq summary::-webkit-details-marker {
  display: none;
}

.faq summary i {
  transition: transform 0.2s;
  color: var(--muted);
}

.faq[open] summary i {
  transform: rotate(180deg);
}

.faq p {
  color: var(--muted);
  margin: 0 0 20px;
}

/* Call to action */
.cta {
  padding: 80px 0;
  background: var(--navy);
  color: #fff;
}

.cta h2 {
  font-size: clamp(26px, 4vw, 36px);
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
</style>
