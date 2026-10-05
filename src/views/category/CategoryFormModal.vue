<script setup lang="ts">
// Add / edit dialog for a category. Pass `category` to edit, or null to add.
import { ref } from 'vue'
import { createCategory, slugify, updateCategory, type Category } from '@/api/categories'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ category: Category | null }>()
const emit = defineEmits<{ close: []; saved: [category: Category, isNew: boolean] }>()

const name = ref(props.category?.name ?? '')
const slug = ref(props.category?.slug ?? '')
const active = ref((props.category?.status ?? 'active') === 'active')
const slugEdited = ref(props.category !== null) // once the user types a slug, stop deriving it from the name
const error = ref('')
const saving = ref(false)

function onNameInput() {
  if (!slugEdited.value) slug.value = slugify(name.value)
}

function onSlugInput() {
  slugEdited.value = slug.value !== ''
}

async function save() {
  error.value = ''
  const input = {
    name: name.value.trim(),
    slug: slug.value.trim() || slugify(name.value),
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  if (!input.name) {
    error.value = 'Category name is required.'
    return
  }

  saving.value = true
  try {
    const saved = props.category ? await updateCategory(props.category.id, input) : await createCategory(input)
    emit('saved', saved, props.category === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the category'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="category ? 'Edit Category' : 'Add Category'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="category-name">Category <span class="text-danger">*</span></label>
          <input
            id="category-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="100"
            required
            autofocus
            @input="onNameInput"
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="category-slug">Slug</label>
          <input
            id="category-slug"
            v-model="slug"
            type="text"
            class="form-control"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers and single dashes"
            @input="onSlugInput"
          />
          <div class="form-text">Filled in from the name. Lowercase letters, numbers and dashes only.</div>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="category-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="category-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="category-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : category ? 'Save Changes' : 'Add Category' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
