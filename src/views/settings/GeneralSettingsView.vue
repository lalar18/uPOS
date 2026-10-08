<script setup lang="ts">
// Store-wide defaults used by the sales screens (the router keeps out roles without settings.manage).
import { computed, ref } from 'vue'
import { getSettings, taxRateText, updateSettings, type Settings } from '@/api/settings'
import { currentUser } from '@/auth'
import { CURRENCIES, currencySymbol, formatMoney, parsePercentBp } from '@/utils/money'

const MAX_QUOTATION_VALID_DAYS = 365
const MAX_RECEIPT_FOOTER_LENGTH = 200

interface Form {
  taxText: string
  validDaysText: string
  receiptFooter: string
  currency: string
}

const settings = ref<Settings | null>(null)
const form = ref<Form>(toForm(null))
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saveSuccess = ref('')
const saving = ref(false)

function toForm(s: Settings | null): Form {
  return {
    taxText: s ? taxRateText(s.defaultTaxRateBp) : '',
    validDaysText: s ? String(s.quotationValidDays) : '',
    receiptFooter: s?.receiptFooter ?? '',
    currency: s?.currency ?? 'PHP',
  }
}

const isDirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(toForm(settings.value)))

const taxRateBp = computed(() => parsePercentBp(form.value.taxText))
const validDays = computed(() => {
  const text = form.value.validDaysText.trim()
  if (!/^\d+$/.test(text)) return NaN
  const days = Number(text)
  return days <= MAX_QUOTATION_VALID_DAYS ? days : NaN
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    settings.value = await getSettings()
    form.value = toForm(settings.value)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the settings'
  } finally {
    loading.value = false
  }
}
load()

async function save() {
  saveError.value = ''
  saveSuccess.value = ''
  if (Number.isNaN(taxRateBp.value)) {
    saveError.value = 'Default tax rate must be a percent from 0 to 100, like 12.'
    return
  }
  if (Number.isNaN(validDays.value)) {
    saveError.value = `Quotation validity must be a whole number of days from 0 to ${MAX_QUOTATION_VALID_DAYS}.`
    return
  }

  saving.value = true
  try {
    settings.value = await updateSettings({
      defaultTaxRateBp: taxRateBp.value,
      quotationValidDays: validDays.value,
      receiptFooter: form.value.receiptFooter,
      currency: form.value.currency,
    })
    form.value = toForm(settings.value)
    // Amounts across the app switch to the new currency right away
    if (currentUser.value) currentUser.value.store.currency = settings.value.currency
    saveSuccess.value = 'Settings saved.'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save the settings'
  } finally {
    saving.value = false
  }
}

function reset() {
  form.value = toForm(settings.value)
  saveError.value = ''
  saveSuccess.value = ''
}
</script>

<template>
  <div class="page-header">
    <div class="page-title">
      <h4>General Settings</h4>
      <h6>Defaults for sales, quotations, receipts and currency</h6>
    </div>
  </div>

  <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between" role="alert">
    {{ loadError }}
    <button type="button" class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
  </div>

  <form v-else class="card" :class="{ 'is-loading': loading }" novalidate @submit.prevent="save">
    <fieldset class="card-body" :disabled="loading || saving">
      <div v-if="saveError" class="alert alert-danger py-2" role="alert">{{ saveError }}</div>
      <div v-if="saveSuccess" class="alert alert-success py-2" role="status">{{ saveSuccess }}</div>

      <h5 class="section-title"><i class="ti ti-receipt-tax me-2"></i>Sales &amp; Quotations</h5>
      <div class="row">
        <div class="col-md-6 mb-3">
          <label class="form-label" for="settings-tax">Default Tax Rate</label>
          <div class="input-group">
            <input
              id="settings-tax"
              v-model="form.taxText"
              type="text"
              class="form-control"
              :class="{ 'is-invalid': Number.isNaN(taxRateBp) }"
              inputmode="decimal"
              maxlength="6"
              placeholder="0"
            />
            <span class="input-group-text">%</span>
          </div>
          <div class="form-text">Filled in on new POS sales, sales and quotations. Each one can still change it.</div>
        </div>
        <div class="col-md-6 mb-3">
          <label class="form-label" for="settings-valid-days">Quotation Valid For</label>
          <div class="input-group">
            <input
              id="settings-valid-days"
              v-model="form.validDaysText"
              type="text"
              class="form-control"
              :class="{ 'is-invalid': Number.isNaN(validDays) }"
              inputmode="numeric"
              maxlength="3"
            />
            <span class="input-group-text">days</span>
          </div>
          <div class="form-text">Sets "valid until" on new quotations. Enter 0 to leave it blank.</div>
        </div>
      </div>

      <h5 class="section-title"><i class="ti ti-coin me-2"></i>Currency</h5>
      <div class="row">
        <div class="col-md-6 mb-3">
          <label class="form-label" for="settings-currency">Store Currency</label>
          <select id="settings-currency" v-model="form.currency" class="form-select">
            <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
              {{ c.code }} · {{ c.name }} ({{ currencySymbol(c.code) }})
            </option>
          </select>
          <div class="form-text">
            Amounts show as {{ formatMoney(123456, form.currency) }} on every page, receipt and invoice.
          </div>
        </div>
        <div v-if="form.currency !== settings?.currency" class="col-md-6 mb-3 d-flex align-items-end">
          <div class="alert alert-warning py-2 mb-0 fs-13 w-100" role="note">
            <i class="ti ti-alert-triangle me-1"></i>Changing the currency only changes the symbol. Existing prices
            and sales keep the same numbers; they are not converted.
          </div>
        </div>
      </div>

      <h5 class="section-title"><i class="ti ti-receipt me-2"></i>Receipts</h5>
      <div class="mb-3">
        <label class="form-label" for="settings-footer">Receipt Message</label>
        <textarea
          id="settings-footer"
          v-model="form.receiptFooter"
          class="form-control"
          rows="3"
          :maxlength="MAX_RECEIPT_FOOTER_LENGTH"
          placeholder="e.g. Thank you for your purchase!"
        ></textarea>
        <div class="form-text d-flex justify-content-between gap-2">
          <span>Printed at the bottom of every receipt. Leave blank for none.</span>
          <span class="flex-shrink-0">{{ form.receiptFooter.length }}/{{ MAX_RECEIPT_FOOTER_LENGTH }}</span>
        </div>
      </div>

      <div class="form-actions d-flex justify-content-end gap-2">
        <button type="button" class="btn btn-secondary" :disabled="!isDirty" @click="reset">Discard Changes</button>
        <button type="submit" class="btn btn-primary" :disabled="!isDirty">
          {{ saving ? 'Saving…' : 'Save Changes' }}
        </button>
      </div>
    </fieldset>
  </form>
</template>

<style scoped>
.is-loading {
  opacity: 0.5;
  transition: opacity 0.15s;
}

fieldset {
  min-width: 0;
}

.section-title {
  font-size: 15px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e6eaed;
}

.row + .section-title {
  margin-top: 8px;
}

@media (max-width: 575.98px) {
  .form-actions .btn {
    flex: 1;
  }
}
</style>
