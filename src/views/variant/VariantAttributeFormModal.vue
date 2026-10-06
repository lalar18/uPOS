<script setup lang="ts">
// Add / edit dialog for a variant attribute. Pass `attribute` to edit, or null to add.
// Values are typed one at a time and added with Enter or a comma (pasting "S, M, L" adds all three).
import { ref } from 'vue'
import { createVariantAttribute, updateVariantAttribute, type VariantAttribute } from '@/api/variantAttributes'
import AppModal from '@/components/AppModal.vue'

const MAX_VALUE_LENGTH = 50

const props = defineProps<{ attribute: VariantAttribute | null }>()
const emit = defineEmits<{ close: []; saved: [attribute: VariantAttribute, isNew: boolean] }>()

const name = ref(props.attribute?.name ?? '')
const values = ref<string[]>([...(props.attribute?.values ?? [])])
const draft = ref('') // the value being typed
const valueInput = ref<HTMLInputElement | null>(null)
const active = ref((props.attribute?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

/** Adds each comma-separated piece of `text`, skipping blanks and repeats. */
function addValues(text: string) {
  for (const piece of text.split(',')) {
    const value = piece.trim().replace(/\s+/g, ' ').slice(0, MAX_VALUE_LENGTH)
    if (value && !values.value.some((v) => v.toLowerCase() === value.toLowerCase())) values.value.push(value)
  }
}

function commitDraft() {
  addValues(draft.value)
  draft.value = ''
}

function onDraftInput() {
  // Typing or pasting a comma adds everything before it
  if (!draft.value.includes(',')) return
  const lastComma = draft.value.lastIndexOf(',')
  addValues(draft.value.slice(0, lastComma))
  draft.value = draft.value.slice(lastComma + 1).trimStart()
}

function onDraftKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault() // don't submit the form
    commitDraft()
  } else if (event.key === 'Backspace' && draft.value === '' && values.value.length > 0) {
    values.value.pop()
  }
}

function removeValue(index: number) {
  values.value.splice(index, 1)
}

async function save() {
  error.value = ''
  commitDraft() // a value still in the box counts
  const input = {
    name: name.value.trim(),
    values: values.value,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  if (!input.name) {
    error.value = 'Variant name is required.'
    return
  }
  if (input.values.length === 0) {
    error.value = 'Add at least one value.'
    return
  }

  saving.value = true
  try {
    const saved = props.attribute
      ? await updateVariantAttribute(props.attribute.id, input)
      : await createVariantAttribute(input)
    emit('saved', saved, props.attribute === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the variant attribute'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="attribute ? 'Edit Variant Attribute' : 'Add Variant Attribute'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="variant-name">Variant <span class="text-danger">*</span></label>
          <input
            id="variant-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="50"
            placeholder="e.g. Size"
            required
            autofocus
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="variant-values">Values <span class="text-danger">*</span></label>
          <div class="tag-input form-control" @click="valueInput?.focus()">
            <span v-for="(value, i) in values" :key="value" class="tag">
              {{ value }}
              <button type="button" :aria-label="`Remove ${value}`" @click.stop="removeValue(i)">
                <i class="ti ti-x"></i>
              </button>
            </span>
            <input
              id="variant-values"
              ref="valueInput"
              v-model="draft"
              type="text"
              :maxlength="MAX_VALUE_LENGTH"
              :placeholder="values.length ? '' : 'e.g. Small, Medium, Large'"
              enterkeyhint="enter"
              @input="onDraftInput"
              @keydown="onDraftKeydown"
              @blur="commitDraft"
            />
          </div>
          <div class="form-text">Press Enter or type a comma after each value.</div>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="variant-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="variant-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="variant-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : attribute ? 'Save Changes' : 'Add Variant' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  height: auto;
  cursor: text;
}

.tag-input input {
  flex: 1;
  min-width: 120px;
  border: 0;
  outline: 0;
  padding: 2px 0;
  background: transparent;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: 6px;
  background: #fff6ee;
  color: #fe9f43;
  font-size: 13px;
  font-weight: 500;
  max-width: 100%;
  word-break: break-word;
}

.tag button {
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
}
</style>
