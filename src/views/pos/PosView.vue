<script setup lang="ts">
// Point of sale (/pos). Tap products, scan a barcode into the search box (USB or Bluetooth
// scanner) or scan barcodes and QR codes with the camera to fill the cart, then Pay. On wide screens the cart sits beside the products; on phones and tablets
// a bar at the bottom shows the total and opens the cart full screen.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PickedCustomer } from '@/api/customers'
import {
  findProductByCode,
  formatQuantity,
  getProductOptions,
  listProducts,
  type Product,
  type ProductOption,
} from '@/api/products'
import {
  computeTotals,
  createSale,
  getSale,
  lineTotal,
  openSaleCheckout,
  type OnlinePaymentInput,
  type PaymentInput,
  type Sale,
  type SaleCheckout,
} from '@/api/sales'
import { getOnlinePaymentCharge, type OnlinePaymentCharge } from '@/api/serviceCharge'
import { getSettingsOrDefaults, taxRateText } from '@/api/settings'
import { getStore, type Store } from '@/api/store'
import AppModal from '@/components/AppModal.vue'
import BarcodeScannerModal, { type ScanResult } from '@/components/BarcodeScannerModal.vue'
import CustomerPicker from '@/components/CustomerPicker.vue'
import { toIsoDate } from '@/utils/date'
import { currencySymbol, formatMoney, newUid, parsePercentBp, parsePeso } from '@/utils/money'
import { usePrintRoot } from '@/utils/print'
import OnlineCheckoutModal from '../sales/OnlineCheckoutModal.vue'
import PaymentFormModal from '../sales/PaymentFormModal.vue'
import ReceiptDocument from '../sales/ReceiptDocument.vue'
import PosPaymentModal from './PosPaymentModal.vue'

const PAGE_SIZE = 24
const MAX_CART_LINES = 200

// --- Products ---

const categories = ref<ProductOption[]>([])
const categoryId = ref<number | null>(null)
const search = ref('')
const products = ref<Product[]>([])
const productTotal = ref(0)
const productPage = ref(1)
const loadingProducts = ref(false)
const productsError = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
let latestProducts = 0

getProductOptions()
  .then((options) => (categories.value = options.categories.filter((c) => c.status === 'active')))
  .catch(() => {}) // the POS still works without category tabs

async function loadProducts(append = false): Promise<Product[]> {
  const requestId = ++latestProducts
  loadingProducts.value = true
  productsError.value = ''
  const page = append ? productPage.value + 1 : 1
  try {
    const result = await listProducts({
      search: search.value.trim(),
      status: 'active',
      categoryId: categoryId.value,
      subcategoryId: null,
      brandId: null,
      page,
      pageSize: PAGE_SIZE,
    })
    if (requestId !== latestProducts) return result.items
    products.value = append ? [...products.value, ...result.items] : result.items
    refreshCart(result.items)
    productTotal.value = result.total
    productPage.value = page
    return result.items
  } catch (e) {
    if (requestId === latestProducts) productsError.value = e instanceof Error ? e.message : 'Could not load products'
    return []
  } finally {
    if (requestId === latestProducts) loadingProducts.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadProducts(), 250)
})
watch(categoryId, () => loadProducts())
loadProducts()

const hasMore = computed(() => products.value.length < productTotal.value)

/** Enter adds the product whose barcode or SKU matches exactly (what a scanner types), or the only result */
async function addFromSearch() {
  clearTimeout(searchTimer)
  const text = search.value.trim().toLowerCase()
  if (!text) return
  const found = await loadProducts()
  const exact = found.find((p) => p.barcode?.toLowerCase() === text || p.sku.toLowerCase() === text)
  const pick = exact ?? (found.length === 1 ? found[0] : undefined)
  if (pick && add(pick)) {
    search.value = ''
    searchInput.value?.focus()
  }
}

// --- Cart ---

interface CartLine {
  product: Product
  quantityText: string
}

const cart = ref<CartLine[]>([])
const customer = ref<PickedCustomer | null>(null)
const discountText = ref('')
const taxText = ref('')
const notice = ref('') // short message about the last tap, e.g. out of stock
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function showNotice(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3000)
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** The line's quantity, or null while it isn't valid for the unit */
function quantityOf(line: CartLine): number | null {
  const text = String(line.quantityText).trim()
  if (text === '') return null
  const value = round3(Number(text))
  if (!Number.isFinite(value) || value <= 0) return null
  if (!line.product.unit.allowDecimal && !Number.isInteger(value)) return null
  return value
}

const lineCents = (line: CartLine) => lineTotal(quantityOf(line) ?? 0, line.product.priceCents)

/** Adds one of the product; returns why it can't be added, or '' when it was */
function addToCart(product: Product): string {
  const line = cart.value.find((l) => l.product.id === product.id)
  const current = line ? (quantityOf(line) ?? 0) : 0
  if (current + 1 > product.quantity) {
    return product.quantity <= 0
      ? `${product.name} is out of stock.`
      : `Only ${formatQuantity(product.quantity)} ${product.unit.shortName} of ${product.name} in stock.`
  }
  if (line) {
    line.quantityText = String(round3(current + 1))
  } else {
    if (cart.value.length >= MAX_CART_LINES) return `A sale can have up to ${MAX_CART_LINES} products.`
    cart.value.push({ product, quantityText: '1' })
  }
  return ''
}

/** Adds one of the product, or shows why it can't be; returns whether it was added */
function add(product: Product): boolean {
  const problem = addToCart(product)
  if (problem) showNotice(problem)
  return !problem
}

// --- Camera scanner ---

const scanning = ref(false)

async function addScanned(code: string): Promise<ScanResult> {
  const product = await findProductByCode(code)
  if (!product) return { ok: false, message: `No product has the code “${code}”.` }
  refreshCart([product])
  const problem = addToCart(product)
  if (problem) return { ok: false, message: problem }
  const line = cart.value.find((l) => l.product.id === product.id)
  const inCart = line ? formatQuantity(quantityOf(line) ?? 0) : '1'
  return { ok: true, message: `Added ${product.name} (${inCart} in cart) · ${formatMoney(product.priceCents)}` }
}

function step(line: CartLine, delta: number) {
  const next = round3((quantityOf(line) ?? 0) + delta)
  if (next <= 0) {
    remove(line)
    return
  }
  if (next > line.product.quantity) {
    showNotice(`Only ${formatQuantity(line.product.quantity)} ${line.product.unit.shortName} in stock.`)
    return
  }
  line.quantityText = String(next)
}

function remove(line: CartLine) {
  cart.value = cart.value.filter((l) => l !== line)
}

/** Gives cart lines the latest stock and price of products just loaded */
function refreshCart(fresh: Product[]) {
  for (const line of cart.value) {
    const product = fresh.find((p) => p.id === line.product.id)
    if (product) line.product = product
  }
}

// The store's default tax rate (General Settings); every new sale starts with it
let defaultTaxText = ''
getSettingsOrDefaults().then((settings) => {
  defaultTaxText = taxRateText(settings.defaultTaxRateBp)
  if (taxText.value === '' && cart.value.length === 0) taxText.value = defaultTaxText
})

function clearCart() {
  cart.value = []
  customer.value = null
  discountText.value = ''
  taxText.value = defaultTaxText
}

const itemCount = computed(() => cart.value.reduce((sum, line) => sum + (quantityOf(line) ?? 0), 0))
const subtotalCents = computed(() => cart.value.reduce((sum, line) => sum + lineCents(line), 0))
const discountCents = computed(() => parsePeso(discountText.value) ?? 0)
const taxRateBp = computed(() => parsePercentBp(taxText.value))
const discountError = computed(() => {
  if (Number.isNaN(discountCents.value)) return 'Enter an amount like 25.00'
  return discountCents.value > subtotalCents.value ? 'More than the subtotal' : ''
})
const taxError = computed(() => (Number.isNaN(taxRateBp.value) ? 'Enter 0 to 100' : ''))
const totals = computed(() =>
  computeTotals(
    cart.value.map(lineCents),
    discountError.value ? 0 : discountCents.value,
    taxError.value ? 0 : taxRateBp.value,
  ),
)

/** The first problem with the cart, or '' when it can be paid */
function cartProblem(): string {
  if (cart.value.length === 0) return 'The cart is empty.'
  for (const line of cart.value) {
    const quantity = quantityOf(line)
    if (quantity === null) {
      return line.product.unit.allowDecimal
        ? `Enter a quantity for ${line.product.name}.`
        : `${line.product.name} needs a whole-number quantity.`
    }
    if (quantity > line.product.quantity) {
      return `Only ${formatQuantity(line.product.quantity)} ${line.product.unit.shortName} of ${line.product.name} in stock.`
    }
  }
  if (discountError.value) return `Discount: ${discountError.value.toLowerCase()}.`
  if (taxError.value) return 'Tax rate must be a percent from 0 to 100.'
  return ''
}

// --- Mobile cart sheet ---

const cartOpen = ref(false)

// --- Paying ---

// One id per cart: paying again after a lost response finds the first sale instead of
// selling twice. A different cart (products, quantities, prices, customer, discount or tax)
// starts a new id; fresh stock figures alone don't.
const cartSignature = computed(() =>
  JSON.stringify([
    cart.value.map((line) => [line.product.id, line.quantityText, line.product.priceCents]),
    customer.value?.id ?? null,
    discountText.value,
    taxText.value,
  ]),
)
let checkoutUid = newUid()
watch(cartSignature, () => (checkoutUid = newUid()))

const paying = ref(false)
const saving = ref(false)
const payError = ref('')
const cartError = ref('')

// The service charge on online payments (refreshed on each payment, in case it changed)
const onlineCharge = ref<OnlinePaymentCharge | null>(null)

function openPayment() {
  cartError.value = cartProblem()
  if (cartError.value) return
  payError.value = ''
  paying.value = true
  getOnlinePaymentCharge().then((charge) => (onlineCharge.value = charge ?? onlineCharge.value))
}

const lastSale = ref<Sale | null>(null)
const store = ref<Store | null>(null)
getStore()
  .then((result) => (store.value = result))
  .catch(() => {})

async function completeSale(payments: PaymentInput[], online: OnlinePaymentInput | null) {
  saving.value = true
  payError.value = ''
  try {
    const sale = await createSale({
      uid: checkoutUid,
      source: 'pos',
      customerId: customer.value?.id ?? null,
      saleDate: toIsoDate(),
      dueDate: null,
      items: cart.value.map((line) => ({
        productId: line.product.id,
        quantity: quantityOf(line)!,
        priceCents: line.product.priceCents,
      })),
      discountCents: totals.value.discountCents,
      taxRateBp: totals.value.taxRateBp,
      note: null,
      payments,
      onlinePayment: online,
    })
    paying.value = false
    cartOpen.value = false
    clearCart()
    loadProducts() // stock has changed
    if (online && sale.dueCents > 0) waitForOnlinePayment(sale, online, sale.checkoutError)
    else lastSale.value = sale
  } catch (e) {
    payError.value = e instanceof Error ? e.message : 'Could not complete the sale'
    loadProducts() // prices or stock may have changed
  } finally {
    saving.value = false
  }
}

// --- Online payment (PayMongo) ---
// The sale is saved first (so its stock is taken), then waits for the customer to pay online.
// If they don't, it keeps its balance: try again, take the payment another way, or leave it.

const onlineSale = ref<Sale | null>(null)
const onlineCheckout = ref<SaleCheckout | null>(null)
const onlineInput = ref<OnlinePaymentInput | null>(null)
const onlineProblem = ref('') // why the sale isn't paid online, while it's left with a balance
const retrying = ref(false)
const payingOther = ref(false)

function waitForOnlinePayment(sale: Sale, input: OnlinePaymentInput, problem?: string) {
  onlineSale.value = sale
  onlineInput.value = input
  onlineCheckout.value = sale.onlineCheckout
  onlineProblem.value = sale.onlineCheckout ? '' : (problem ?? 'The online payment could not be opened.')
}

function endOnlinePayment() {
  onlineSale.value = null
  onlineCheckout.value = null
  onlineProblem.value = ''
  payingOther.value = false
}

async function onlinePaid() {
  const sale = onlineSale.value!
  endOnlinePayment()
  lastSale.value = await getSale(sale.id).catch(() => sale)
}

function onlineCancelled() {
  onlineCheckout.value = null
  onlineProblem.value = 'The online payment was cancelled.'
}

async function retryOnline() {
  const sale = onlineSale.value!
  retrying.value = true
  try {
    const latest = await getSale(sale.id)
    onlineSale.value = latest
    if (latest.dueCents <= 0) return onlinePaid()
    const amountCents = Math.min(onlineInput.value!.amountCents, latest.dueCents)
    onlineCheckout.value = await openSaleCheckout(sale.id, { ...onlineInput.value!, amountCents })
    onlineProblem.value = ''
  } catch (e) {
    onlineProblem.value = e instanceof Error ? e.message : 'The online payment could not be opened.'
  } finally {
    retrying.value = false
  }
}

function paidOtherWay(sale: Sale) {
  endOnlinePayment()
  if (sale.dueCents > 0) {
    // Part paid: the rest stays on the sale's balance
    onlineSale.value = sale
    onlineProblem.value = `${formatMoney(sale.dueCents)} is still due on this sale.`
    return
  }
  lastSale.value = sale
}

// --- Receipt ---

usePrintRoot(() => '@page { size: 80mm auto; margin: 3mm; }')

function printReceipt() {
  window.print()
}

function newSale() {
  lastSale.value = null
  searchInput.value?.focus()
}

// The cart sheet covers the page on phones; stop the page behind it from scrolling
watch(cartOpen, (open) => document.body.classList.toggle('pos-cart-open', open))
onMounted(() => searchInput.value?.focus())
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  clearTimeout(noticeTimer)
  document.body.classList.remove('pos-cart-open')
})
</script>

<template>
  <div class="pos">
    <!-- Products -->
    <section class="pos-products">
      <div class="pos-search mb-2">
        <div class="search-field">
          <span class="search-icon"><i class="ti ti-search"></i></span>
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Search or scan barcode / SKU"
            aria-label="Search products"
            autocomplete="off"
            @keydown.enter.prevent="addFromSearch"
          />
        </div>
        <button type="button" class="btn btn-primary scan-button" title="Scan with camera" @click="scanning = true">
          <i class="ti ti-scan"></i><span class="d-none d-sm-inline ms-1">Scan</span>
        </button>
      </div>

      <div class="category-tabs mb-3" role="tablist" aria-label="Categories">
        <button
          type="button"
          role="tab"
          :aria-selected="categoryId === null"
          :class="{ active: categoryId === null }"
          @click="categoryId = null"
        >
          All
        </button>
        <button
          v-for="c in categories"
          :key="c.id"
          type="button"
          role="tab"
          :aria-selected="categoryId === c.id"
          :class="{ active: categoryId === c.id }"
          @click="categoryId = c.id"
        >
          {{ c.name }}
        </button>
      </div>

      <div v-if="notice" class="alert alert-warning py-2 notice" role="status">{{ notice }}</div>
      <div v-if="productsError" class="alert alert-danger py-2" role="alert">{{ productsError }}</div>

      <div class="product-grid" :class="{ 'is-loading': loadingProducts }">
        <button
          v-for="product in products"
          :key="product.id"
          type="button"
          class="product-tile"
          :class="{ 'out-of-stock': product.quantity <= 0 }"
          @click="add(product)"
        >
          <span class="tile-image">
            <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" loading="lazy" />
            <i v-else class="ti ti-box"></i>
          </span>
          <span class="tile-name">{{ product.name }}</span>
          <span class="tile-meta">
            <span class="tile-price">{{ formatMoney(product.priceCents) }}</span>
            <span class="tile-stock" :class="{ 'text-danger': product.quantity <= product.alertQuantity }">
              {{ product.quantity <= 0 ? 'Out' : `${formatQuantity(product.quantity)} ${product.unit.shortName}` }}
            </span>
          </span>
        </button>
      </div>

      <div v-if="!loadingProducts && !productsError && products.length === 0" class="text-center text-gray-5 py-5">
        <i class="ti ti-box fs-24 d-block mb-2"></i>No products found.
      </div>
      <div v-if="hasMore" class="text-center mt-3">
        <button type="button" class="btn btn-white border" :disabled="loadingProducts" @click="loadProducts(true)">
          {{ loadingProducts ? 'Loading…' : `Load more (${productTotal - products.length} left)` }}
        </button>
      </div>
    </section>

    <!-- Cart -->
    <aside class="pos-cart" :class="{ open: cartOpen }" aria-label="Cart">
      <div class="cart-head">
        <h5 class="mb-0">Cart <span v-if="cart.length" class="text-gray-5 fw-normal fs-14">({{ formatQuantity(itemCount) }})</span></h5>
        <div class="d-flex gap-2">
          <button v-if="cart.length" type="button" class="btn btn-sm btn-white border text-danger" @click="clearCart">
            Clear
          </button>
          <button type="button" class="btn btn-sm btn-white border d-lg-none" aria-label="Close cart" @click="cartOpen = false">
            <i class="ti ti-x"></i>
          </button>
        </div>
      </div>

      <div class="cart-customer">
        <CustomerPicker v-model="customer" />
      </div>

      <div class="cart-lines">
        <div v-if="cart.length === 0" class="text-center text-gray-5 py-5">
          <i class="ti ti-shopping-cart fs-24 d-block mb-2"></i>Tap or scan a product to add it.
        </div>
        <div v-for="line in cart" :key="line.product.id" class="cart-line">
          <div class="d-flex justify-content-between gap-2">
            <div class="min-w-0">
              <div class="fw-medium text-gray-9 text-break">{{ line.product.name }}</div>
              <div class="fs-12 text-gray-5">{{ formatMoney(line.product.priceCents) }} / {{ line.product.unit.shortName }}</div>
            </div>
            <button type="button" class="btn-icon text-danger" :aria-label="`Remove ${line.product.name}`" @click="remove(line)">
              <i class="ti ti-trash"></i>
            </button>
          </div>
          <div class="d-flex justify-content-between align-items-center gap-2 mt-1">
            <div class="stepper">
              <button type="button" :aria-label="`One less ${line.product.name}`" @click="step(line, -1)">
                <i class="ti ti-minus"></i>
              </button>
              <input
                v-model="line.quantityText"
                type="number"
                min="0"
                :step="line.product.unit.allowDecimal ? '0.001' : '1'"
                :inputmode="line.product.unit.allowDecimal ? 'decimal' : 'numeric'"
                :class="{ invalid: quantityOf(line) === null || (quantityOf(line) ?? 0) > line.product.quantity }"
                :aria-label="`Quantity of ${line.product.name}`"
              />
              <button type="button" :aria-label="`One more ${line.product.name}`" @click="step(line, 1)">
                <i class="ti ti-plus"></i>
              </button>
            </div>
            <div class="fw-semibold text-gray-9">{{ formatMoney(lineCents(line)) }}</div>
          </div>
        </div>
      </div>

      <div class="cart-foot">
        <div class="foot-row">
          <span>Subtotal</span><span>{{ formatMoney(totals.subtotalCents) }}</span>
        </div>
        <div class="foot-row">
          <label for="pos-discount">Discount</label>
          <div class="input-group input-group-sm foot-input">
            <span class="input-group-text">{{ currencySymbol() }}</span>
            <input
              id="pos-discount"
              v-model="discountText"
              type="text"
              class="form-control text-end"
              inputmode="decimal"
              placeholder="0.00"
              :class="{ 'is-invalid': discountError }"
            />
          </div>
        </div>
        <div class="foot-row">
          <label for="pos-tax">Tax</label>
          <div class="input-group input-group-sm foot-input">
            <input
              id="pos-tax"
              v-model="taxText"
              type="text"
              class="form-control text-end"
              inputmode="decimal"
              placeholder="0"
              :class="{ 'is-invalid': taxError }"
            />
            <span class="input-group-text">%</span>
          </div>
        </div>
        <div v-if="totals.taxCents > 0" class="foot-row text-gray-5">
          <span>Tax amount</span><span>{{ formatMoney(totals.taxCents) }}</span>
        </div>
        <div class="foot-row foot-total">
          <span>Total</span><span>{{ formatMoney(totals.totalCents) }}</span>
        </div>
        <div v-if="cartError" class="text-danger fs-13 mb-2">{{ cartError }}</div>
        <button type="button" class="btn btn-success btn-lg w-100" :disabled="cart.length === 0" @click="openPayment">
          <i class="ti ti-cash me-1"></i>Pay {{ formatMoney(totals.totalCents) }}
        </button>
      </div>
    </aside>

    <!-- Phones and tablets: the cart's total, which opens the cart -->
    <div class="cart-bar d-lg-none">
      <div class="min-w-0">
        <div class="fs-12 text-gray-5">{{ formatQuantity(itemCount) }} {{ itemCount === 1 ? 'item' : 'items' }}</div>
        <div class="fw-bold text-gray-9 fs-18">{{ formatMoney(totals.totalCents) }}</div>
      </div>
      <button type="button" class="btn btn-primary" @click="cartOpen = true">
        <i class="ti ti-shopping-cart me-1"></i>View Cart
      </button>
    </div>
  </div>

  <BarcodeScannerModal v-if="scanning" :on-scan="addScanned" @close="scanning = false" />

  <PosPaymentModal
    v-if="paying"
    :total-cents="totals.totalCents"
    :customer-name="customer?.name ?? null"
    :charge="onlineCharge"
    :saving="saving"
    :error="payError"
    @close="paying = false"
    @confirm="completeSale"
  />

  <!-- Online payment of the sale just saved -->
  <OnlineCheckoutModal
    v-if="onlineSale && onlineCheckout"
    :checkout="onlineCheckout"
    :sale-reference="onlineSale.reference"
    @paid="onlinePaid"
    @cancelled="onlineCancelled"
    @close="endOnlinePayment"
  />
  <PaymentFormModal
    v-else-if="onlineSale && payingOther"
    :sale="onlineSale"
    @close="payingOther = false"
    @saved="paidOtherWay"
  />
  <AppModal v-else-if="onlineSale" :title="`Not paid yet · ${onlineSale.reference}`" @close="endOnlinePayment">
    <div class="modal-body">
      <div class="alert alert-warning py-2" role="alert">{{ onlineProblem }}</div>
      <p class="mb-0">
        The sale is saved, with <strong>{{ formatMoney(onlineSale.dueCents) }}</strong> still due. Try the online payment
        again, or take the payment another way. You can also leave it and record the payment later from the sale.
      </p>
    </div>
    <div class="modal-footer flex-wrap">
      <button type="button" class="btn btn-secondary" :disabled="retrying" @click="endOnlinePayment">Leave Unpaid</button>
      <button type="button" class="btn btn-white border" :disabled="retrying" @click="payingOther = true">
        Pay Another Way
      </button>
      <button v-if="onlineInput" type="button" class="btn btn-primary" :disabled="retrying" @click="retryOnline">
        {{ retrying ? 'Opening…' : 'Try Online Again' }}
      </button>
    </div>
  </AppModal>

  <!-- Receipt after a sale -->
  <AppModal v-if="lastSale" :title="`Sale complete · ${lastSale.reference}`" size="sm" @close="newSale">
    <div class="modal-body receipt-preview">
      <div v-if="lastSale.payments[0]?.changeCents" class="change-banner mb-3">
        Change: {{ formatMoney(lastSale.payments[0].changeCents) }}
      </div>
      <ReceiptDocument :sale="lastSale" :store="store" />
    </div>
    <div class="modal-footer">
      <RouterLink :to="{ name: 'sale-detail', params: { id: lastSale.id } }" class="btn btn-white border">View Sale</RouterLink>
      <button type="button" class="btn btn-white border" @click="printReceipt"><i class="ti ti-printer me-1"></i>Print</button>
      <button type="button" class="btn btn-primary" @click="newSale">New Sale</button>
    </div>
  </AppModal>

  <!-- The copy that prints (hidden on screen) -->
  <Teleport to="body">
    <div v-if="lastSale" class="print-root">
      <ReceiptDocument :sale="lastSale" :store="store" />
    </div>
  </Teleport>
</template>

<style scoped>
.pos {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding-bottom: 72px; /* room for the cart bar */
}

@media (min-width: 992px) {
  .pos {
    grid-template-columns: minmax(0, 1fr) 360px;
    align-items: start;
    padding-bottom: 0;
  }
}

@media (min-width: 1400px) {
  .pos {
    grid-template-columns: minmax(0, 1fr) 400px;
  }
}

/* --- Products --- */

.pos-search {
  display: flex;
  gap: 8px;
}

.search-field {
  position: relative;
  flex: 1;
  min-width: 0;
}

.scan-button {
  flex-shrink: 0;
  height: 44px;
  font-size: 15px;
}

.pos-search .search-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: #a6aaaf;
  font-size: 18px;
  pointer-events: none;
}

.pos-search input {
  height: 44px;
  padding-left: 40px;
}

.category-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.category-tabs button {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 1px solid #e6eaed;
  border-radius: 20px;
  background: #ffffff;
  color: #646b72;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.category-tabs button.active {
  border-color: #fe9f43;
  background: #fe9f43;
  color: #ffffff;
}

.notice {
  position: sticky;
  top: 70px;
  z-index: 5;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}

@media (min-width: 576px) {
  .product-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}

.product-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #e6eaed;
  border-radius: 10px;
  background: #ffffff;
  text-align: left;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.product-tile:hover,
.product-tile:focus-visible {
  border-color: #fe9f43;
  box-shadow: 0 4px 12px rgba(254, 159, 67, 0.15);
}

.product-tile:active {
  transform: scale(0.98);
}

.product-tile.out-of-stock {
  opacity: 0.55;
}

.tile-image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 28px;
  overflow: hidden;
}

.tile-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tile-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.6em;
  color: #212b36;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}

.tile-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px;
}

.tile-price {
  color: #fe9f43;
  font-weight: 700;
}

.tile-stock {
  color: #646b72;
  font-size: 11px;
  white-space: nowrap;
}

/* --- Cart --- */

.pos-cart {
  display: flex;
  flex-direction: column;
  border: 1px solid #e6eaed;
  border-radius: 10px;
  background: #ffffff;
}

@media (min-width: 992px) {
  .pos-cart {
    position: sticky;
    top: 80px;
    max-height: calc(100vh - 100px);
  }
}

/* Phones and tablets: the cart opens as a full-screen sheet */
@media (max-width: 991.98px) {
  .pos-cart {
    position: fixed;
    inset: 0;
    z-index: 1040;
    border: 0;
    border-radius: 0;
    transform: translateY(100%);
    visibility: hidden;
    transition:
      transform 0.25s ease,
      visibility 0.25s;
  }

  .pos-cart.open {
    transform: none;
    visibility: visible;
  }
}

.cart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #e6eaed;
}

.cart-customer {
  padding: 10px 14px;
  border-bottom: 1px solid #e6eaed;
}

.cart-lines {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
}

.cart-line {
  padding: 10px 14px;
  border-bottom: 1px solid #f2f4f7;
}

.btn-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
}

.btn-icon:hover {
  background: #ffeeec;
}

.stepper {
  display: inline-flex;
  align-items: center;
  border: 1px solid #e6eaed;
  border-radius: 8px;
  overflow: hidden;
}

.stepper button {
  width: 32px;
  height: 32px;
  border: 0;
  background: #f9fafb;
  color: #212b36;
}

.stepper button:hover {
  background: #e6eaed;
}

.stepper input {
  width: 64px;
  height: 32px;
  border: 0;
  border-left: 1px solid #e6eaed;
  border-right: 1px solid #e6eaed;
  text-align: center;
  -moz-appearance: textfield;
  appearance: textfield;
}

.stepper input::-webkit-outer-spin-button,
.stepper input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stepper input.invalid {
  background: #ffeeec;
  color: #ff0000;
}

.cart-foot {
  padding: 12px 14px;
  border-top: 1px solid #e6eaed;
  background: #f9fafb;
  border-radius: 0 0 10px 10px;
}

.foot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 3px 0;
}

.foot-row label {
  margin: 0;
}

.foot-input {
  width: 130px;
}

.foot-total {
  margin: 6px 0 10px;
  padding-top: 8px;
  border-top: 1px solid #e6eaed;
  color: #212b36;
  font-size: 20px;
  font-weight: 700;
}

.cart-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 98; /* under the template's sidebar overlay (99), sidebar and header */
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #e6eaed;
  background: #ffffff;
  box-shadow: 0 -4px 16px rgba(16, 24, 40, 0.08);
}

.change-banner {
  padding: 10px;
  border-radius: 8px;
  background: #eafaf2;
  color: #3eb780;
  font-size: 20px;
  font-weight: 700;
  text-align: center;
}

.receipt-preview {
  max-height: 60vh;
  overflow-y: auto;
}

.min-w-0 {
  min-width: 0;
}

.is-loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}
</style>

<style>
/* Not scoped: the body class is toggled by the POS while its cart sheet is open */
body.pos-cart-open {
  overflow: hidden;
}
</style>
