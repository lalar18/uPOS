<script setup lang="ts">
// Add / edit page for a product: /products/create, or /products/:id/edit.
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  createProduct,
  generateSku,
  getProduct,
  getProductOptions,
  removeProductImage,
  updateProduct,
  uploadProductImage,
  type Product,
  type ProductInput,
  type ProductOption,
  type ProductOptions,
} from '@/api/products'
import { currentUser } from '@/auth'
import { resizeImage } from '@/utils/image'

const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB, checked on the original file
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_SIZE = 600 // images are scaled down to fit a 600x600 px box

const props = defineProps<{ id?: string }>() // from the route; absent when adding
const router = useRouter()

const isAdmin = computed(() => currentUser.value?.role === 'admin')
const isNew = computed(() => props.id === undefined)

// --- Loading ---

const loading = ref(true)
const loadError = ref('')
const options = ref<ProductOptions>({ categories: [], subcategories: [], brands: [], units: [] })
let original: Product | null = null

// Form fields. Money and quantities are kept as typed text and parsed on save.
const name = ref('')
const sku = ref('')
const barcode = ref('')
const categoryId = ref<number | null>(null)
const subcategoryId = ref<number | null>(null)
const brandId = ref<number | null>(null)
const unitId = ref<number | null>(null)
const price = ref('')
const cost = ref('')
const quantity = ref('0')
const alertQuantity = ref('0')
const description = ref('')
const active = ref(true)

const centsToText = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [loadedOptions, product] = await Promise.all([
      getProductOptions(),
      isNew.value ? null : getProduct(Number(props.id)),
    ])
    options.value = loadedOptions
    original = product

    if (product) {
      name.value = product.name
      sku.value = product.sku
      barcode.value = product.barcode ?? ''
      categoryId.value = product.category?.id ?? null
      subcategoryId.value = product.subcategory?.id ?? null
      brandId.value = product.brand?.id ?? null
      unitId.value = product.unit.id
      price.value = centsToText(product.priceCents)
      cost.value = centsToText(product.costCents)
      quantity.value = String(product.quantity)
      alertQuantity.value = String(product.alertQuantity)
      description.value = product.description ?? ''
      active.value = product.status === 'active'
      imagePreview.value = product.imageUrl
    } else {
      // Default to "pc" where the store has it, else the first active unit
      const activeUnits = loadedOptions.units.filter((u) => u.status === 'active')
      unitId.value = (activeUnits.find((u) => u.shortName.toLowerCase() === 'pc') ?? activeUnits[0])?.id ?? null
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the product'
  } finally {
    loading.value = false
  }
}

/** Active choices, plus the current pick if it has since been made inactive */
function choices<T extends ProductOption>(list: T[], selectedId: number | null): T[] {
  return list.filter((item) => item.status === 'active' || item.id === selectedId)
}

const categoryChoices = computed(() => choices(options.value.categories, categoryId.value))
// Only the chosen category's sub categories
const subcategoryChoices = computed(() =>
  choices(
    options.value.subcategories.filter((s) => s.categoryId === categoryId.value),
    subcategoryId.value,
  ),
)
const brandChoices = computed(() => choices(options.value.brands, brandId.value))
const unitChoices = computed(() => choices(options.value.units, unitId.value))
const selectedUnit = computed(() => options.value.units.find((u) => u.id === unitId.value) ?? null)
const quantityStep = computed(() => (selectedUnit.value?.allowDecimal ? '0.001' : '1'))

function onCategoryChange() {
  subcategoryId.value = null // the old pick belongs to the previous category
}

// --- Image ---

const fileInput = ref<HTMLInputElement | null>(null)
const imageFile = ref<File | null>(null) // newly picked, uploaded on save
const imagePreview = ref<string | null>(null)
const imageRemoved = ref(false) // the existing image should be deleted on save

function revokePreview() {
  if (imagePreview.value?.startsWith('blob:')) URL.revokeObjectURL(imagePreview.value)
}
onBeforeUnmount(revokePreview)

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // lets the same file be picked again
  error.value = ''

  if (!file) return
  if (!ALLOWED_TYPES.includes(file.type)) {
    error.value = 'Please choose a JPG, PNG or WebP image.'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`
    return
  }

  revokePreview()
  imageFile.value = file
  imagePreview.value = URL.createObjectURL(file)
  imageRemoved.value = false
}

function removeImage() {
  revokePreview()
  imageFile.value = null
  imagePreview.value = null
  imageRemoved.value = original?.imageUrl != null
}

// --- Saving ---

const error = ref('')
const saving = ref(false)
// The saved product. Set after a create, so a retry (e.g. the image upload failed) updates instead of adding twice.
let savedId: number | null = null

/** "12.5" -> 1250 centavos; '' -> null; anything else (or more than 2 decimals) -> NaN */
function parsePeso(text: string): number | null {
  const clean = text.replace(/[₱,\s]/g, '')
  if (clean === '') return null
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : NaN
}

function parseQuantity(text: string, label: string): number | string {
  const value = Number(text === '' ? 0 : text)
  if (!Number.isFinite(value) || value < 0) return `${label} must be zero or more.`
  if (!selectedUnit.value?.allowDecimal && !Number.isInteger(value)) {
    return `${label} must be a whole number for ${selectedUnit.value?.name ?? 'this unit'}.`
  }
  return value
}

/** Checks the form and builds the API body, or returns the first problem as a message. */
function buildInput(): ProductInput | string {
  if (!name.value.trim()) return 'Product name is required.'
  if (!sku.value.trim()) return 'SKU is required. Tap Generate if the product has none.'
  if (unitId.value === null) return 'Unit is required.'

  const priceCents = parsePeso(price.value)
  if (priceCents === null) return 'Selling price is required.'
  if (Number.isNaN(priceCents)) return 'Selling price must be an amount like 12.50.'
  const costCents = parsePeso(cost.value)
  if (Number.isNaN(costCents)) return 'Cost price must be an amount like 9.75.'

  const qty = parseQuantity(quantity.value, 'Quantity')
  if (typeof qty === 'string') return qty
  const alert = parseQuantity(alertQuantity.value, 'Low stock alert')
  if (typeof alert === 'string') return alert

  return {
    name: name.value.trim(),
    sku: sku.value.trim(),
    barcode: barcode.value.trim() || null,
    categoryId: categoryId.value,
    subcategoryId: subcategoryId.value,
    brandId: brandId.value,
    unitId: unitId.value,
    priceCents,
    costCents,
    quantity: qty,
    alertQuantity: alert,
    description: description.value.trim() || null,
    status: active.value ? 'active' : 'inactive',
  }
}

async function save() {
  error.value = ''
  const input = buildInput()
  if (typeof input === 'string') {
    error.value = input
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  saving.value = true
  try {
    const id = original?.id ?? savedId
    const saved = id !== null ? await updateProduct(id, input) : await createProduct(input)
    savedId = saved.id
    if (imageFile.value) await uploadProductImage(saved.id, await resizeImage(imageFile.value, IMAGE_SIZE))
    else if (imageRemoved.value) await removeProductImage(saved.id)
    router.push({ name: 'products' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the product'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } finally {
    saving.value = false
  }
}

load()
</script>

<template>
  <div class="page-header flex-wrap gap-2">
    <div class="page-title">
      <h4>{{ isNew ? 'Create Product' : 'Edit Product' }}</h4>
      <h6>{{ isNew ? 'Add a new product to your store' : 'Update product details' }}</h6>
    </div>
    <RouterLink :to="{ name: 'products' }" class="btn btn-secondary">
      <i class="ti ti-arrow-left me-1"></i>Back to Products
    </RouterLink>
  </div>

  <div v-if="!isAdmin" class="card">
    <div class="card-body text-center text-gray-5 py-5">
      <i class="ti ti-lock fs-24 d-block mb-2"></i>
      Only admins can add or edit products.
    </div>
  </div>

  <div v-else-if="loading" class="card">
    <div class="card-body text-center text-gray-5 py-5">Loading…</div>
  </div>

  <div v-else-if="loadError" class="card">
    <div class="card-body">
      <div class="alert alert-danger py-2 mb-3" role="alert">{{ loadError }}</div>
      <button type="button" class="btn btn-primary" @click="load">Try Again</button>
    </div>
  </div>

  <form v-else novalidate @submit.prevent="save">
    <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
    <div v-if="options.units.length === 0" class="alert alert-warning py-2" role="alert">
      Your store has no units yet. <RouterLink :to="{ name: 'units' }">Add a unit</RouterLink> (like "Piece") first.
    </div>

    <div class="row g-3">
      <div class="col-lg-8">
        <!-- Product information -->
        <div class="card mb-3">
          <div class="card-header">
            <h5 class="card-title mb-0"><i class="ti ti-info-circle me-1 text-primary"></i>Product Information</h5>
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label" for="product-name">Product Name <span class="text-danger">*</span></label>
                <input
                  id="product-name"
                  v-model="name"
                  type="text"
                  class="form-control"
                  maxlength="150"
                  placeholder="e.g. Coca-Cola 1.5L"
                  required
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-sku">SKU <span class="text-danger">*</span></label>
                <div class="input-group">
                  <input
                    id="product-sku"
                    v-model="sku"
                    type="text"
                    class="form-control"
                    maxlength="50"
                    autocapitalize="characters"
                    spellcheck="false"
                    required
                  />
                  <button type="button" class="btn btn-outline-secondary" @click="sku = generateSku()">Generate</button>
                </div>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-barcode">Barcode</label>
                <input
                  id="product-barcode"
                  v-model="barcode"
                  type="text"
                  class="form-control"
                  maxlength="50"
                  inputmode="numeric"
                  spellcheck="false"
                  placeholder="Scan or type"
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-category">Category</label>
                <select id="product-category" v-model="categoryId" class="form-select" @change="onCategoryChange">
                  <option :value="null">None</option>
                  <option v-for="c in categoryChoices" :key="c.id" :value="c.id">
                    {{ c.name }}{{ c.status === 'inactive' ? ' (inactive)' : '' }}
                  </option>
                </select>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-subcategory">Sub Category</label>
                <select
                  id="product-subcategory"
                  v-model="subcategoryId"
                  class="form-select"
                  :disabled="categoryId === null || subcategoryChoices.length === 0"
                >
                  <option :value="null">{{ categoryId === null ? 'Choose a category first' : 'None' }}</option>
                  <option v-for="s in subcategoryChoices" :key="s.id" :value="s.id">
                    {{ s.name }}{{ s.status === 'inactive' ? ' (inactive)' : '' }}
                  </option>
                </select>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-brand">Brand</label>
                <select id="product-brand" v-model="brandId" class="form-select">
                  <option :value="null">None</option>
                  <option v-for="b in brandChoices" :key="b.id" :value="b.id">
                    {{ b.name }}{{ b.status === 'inactive' ? ' (inactive)' : '' }}
                  </option>
                </select>
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="product-unit">Unit <span class="text-danger">*</span></label>
                <select id="product-unit" v-model="unitId" class="form-select" required>
                  <option v-if="unitId === null" :value="null" disabled>Choose a unit</option>
                  <option v-for="u in unitChoices" :key="u.id" :value="u.id">
                    {{ u.name }} ({{ u.shortName }}){{ u.status === 'inactive' ? ' (inactive)' : '' }}
                  </option>
                </select>
              </div>
              <div class="col-12">
                <label class="form-label" for="product-description">Description</label>
                <textarea
                  id="product-description"
                  v-model="description"
                  class="form-control"
                  rows="3"
                  maxlength="2000"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- Pricing and stock -->
        <div class="card mb-0">
          <div class="card-header">
            <h5 class="card-title mb-0"><i class="ti ti-currency-peso me-1 text-primary"></i>Pricing &amp; Stock</h5>
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-6">
                <label class="form-label" for="product-price">Selling Price <span class="text-danger">*</span></label>
                <div class="input-group">
                  <span class="input-group-text">₱</span>
                  <input
                    id="product-price"
                    v-model="price"
                    type="text"
                    class="form-control"
                    inputmode="decimal"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div class="col-6">
                <label class="form-label" for="product-cost">Cost Price</label>
                <div class="input-group">
                  <span class="input-group-text">₱</span>
                  <input
                    id="product-cost"
                    v-model="cost"
                    type="text"
                    class="form-control"
                    inputmode="decimal"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div class="col-6">
                <label class="form-label" for="product-quantity">Quantity in Stock</label>
                <div class="input-group">
                  <input
                    id="product-quantity"
                    v-model="quantity"
                    type="number"
                    class="form-control"
                    min="0"
                    :step="quantityStep"
                    :inputmode="selectedUnit?.allowDecimal ? 'decimal' : 'numeric'"
                  />
                  <span v-if="selectedUnit" class="input-group-text">{{ selectedUnit.shortName }}</span>
                </div>
              </div>
              <div class="col-6">
                <label class="form-label" for="product-alert">Low Stock Alert</label>
                <div class="input-group">
                  <input
                    id="product-alert"
                    v-model="alertQuantity"
                    type="number"
                    class="form-control"
                    min="0"
                    :step="quantityStep"
                    :inputmode="selectedUnit?.allowDecimal ? 'decimal' : 'numeric'"
                  />
                  <span v-if="selectedUnit" class="input-group-text">{{ selectedUnit.shortName }}</span>
                </div>
                <div class="form-text">Flag as low stock at or below this.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <!-- Image -->
        <div class="card mb-3">
          <div class="card-header">
            <h5 class="card-title mb-0"><i class="ti ti-photo me-1 text-primary"></i>Image</h5>
          </div>
          <div class="card-body">
            <div class="d-flex flex-lg-column align-items-center gap-3">
              <button
                type="button"
                class="image-box"
                :aria-label="imagePreview ? 'Change image' : 'Upload image'"
                @click="fileInput?.click()"
              >
                <img v-if="imagePreview" :src="imagePreview" alt="Product image" />
                <i v-else class="ti ti-photo-plus"></i>
              </button>
              <div class="text-lg-center">
                <div class="d-flex flex-wrap justify-content-lg-center gap-2">
                  <button type="button" class="btn btn-sm btn-primary" @click="fileInput?.click()">
                    <i class="ti ti-upload me-1"></i>{{ imagePreview ? 'Change' : 'Upload' }}
                  </button>
                  <button v-if="imagePreview" type="button" class="btn btn-sm btn-secondary" @click="removeImage">
                    Remove
                  </button>
                </div>
                <div class="form-text">JPG, PNG or WebP, up to 2 MB.</div>
              </div>
            </div>
            <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onFileChosen" />
          </div>
        </div>

        <!-- Status -->
        <div class="card mb-0">
          <div class="card-body d-flex align-items-center justify-content-between">
            <div>
              <label class="form-label mb-0" for="product-status">Status</label>
              <div class="form-text mt-0">Inactive products are hidden from sales.</div>
            </div>
            <div class="form-check form-switch mb-0">
              <input id="product-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
              <label class="form-check-label" for="product-status">{{ active ? 'Active' : 'Inactive' }}</label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions (stick to the bottom of the screen on phones) -->
    <div class="form-actions d-flex justify-content-end gap-2">
      <RouterLink :to="{ name: 'products' }" class="btn btn-secondary" :class="{ disabled: saving }">Cancel</RouterLink>
      <button type="submit" class="btn btn-primary" :disabled="saving || options.units.length === 0">
        {{ saving ? 'Saving…' : isNew ? 'Create Product' : 'Save Changes' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.image-box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 96px;
  height: 96px;
  padding: 0;
  border: 1px dashed #d0d5dd;
  border-radius: 8px;
  background: #f9fafb;
  color: #a6aaaf;
  font-size: 28px;
  overflow: hidden;
}

.image-box:hover {
  border-color: #fe9f43;
  color: #fe9f43;
}

.image-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (min-width: 992px) {
  .image-box {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    max-width: 240px;
    font-size: 40px;
  }
}

.form-actions {
  margin-top: 24px;
}

@media (max-width: 575.98px) {
  .form-actions {
    position: sticky;
    bottom: 0;
    z-index: 10;
    margin: 16px -15px -15px; /* bleed over the page padding to the screen edges */
    padding: 12px 15px;
    border-top: 1px solid #e6eaed;
    background: #ffffff;
  }

  .form-actions > * {
    flex: 1;
  }
}
</style>
