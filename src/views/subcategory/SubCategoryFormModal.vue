<script setup lang="ts">
// Add / edit dialog for a sub category. Pass `subcategory` to edit, or null to add.
import { computed, ref } from 'vue'
import type { ProductOption } from '@/api/products'
import { createSubcategory, updateSubcategory, type Subcategory } from '@/api/subcategories'
import AppModal from '@/components/AppModal.vue'

const props = defineProps<{ subcategory: Subcategory | null; categories: ProductOption[] }>()
const emit = defineEmits<{ close: []; saved: [subcategory: Subcategory, isNew: boolean] }>()

const categoryId = ref<number | null>(props.subcategory?.category.id ?? null)
const name = ref(props.subcategory?.name ?? '')
const description = ref(props.subcategory?.description ?? '')
const active = ref((props.subcategory?.status ?? 'active') === 'active')
const error = ref('')
const saving = ref(false)

// Active categories, plus the current one if it has since been made inactive
const categoryChoices = computed(() =>
  props.categories.filter((c) => c.status === 'active' || c.id === categoryId.value),
)

async function save() {
  error.value = ''
  if (categoryId.value === null) {
    error.value = 'Category is required.'
    return
  }
  const input = {
    categoryId: categoryId.value,
    name: name.value.trim(),
    description: description.value.trim() || null,
    status: active.value ? ('active' as const) : ('inactive' as const),
  }
  if (!input.name) {
    error.value = 'Sub category name is required.'
    return
  }

  saving.value = true
  try {
    const saved = props.subcategory
      ? await updateSubcategory(props.subcategory.id, input)
      : await createSubcategory(input)
    emit('saved', saved, props.subcategory === null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the sub category'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="subcategory ? 'Edit Sub Category' : 'Add Sub Category'" @close="emit('close')">
    <form @submit.prevent="save">
      <div class="modal-body">
        <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label" for="subcategory-category">Parent Category <span class="text-danger">*</span></label>
          <select id="subcategory-category" v-model="categoryId" class="form-select" required>
            <option :value="null" disabled>Choose a category</option>
            <option v-for="c in categoryChoices" :key="c.id" :value="c.id">
              {{ c.name }}{{ c.status === 'inactive' ? ' (inactive)' : '' }}
            </option>
          </select>
          <div v-if="categories.length === 0" class="form-text">
            No categories yet. <RouterLink :to="{ name: 'categories' }">Add a category</RouterLink> first.
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="subcategory-name">Sub Category <span class="text-danger">*</span></label>
          <input
            id="subcategory-name"
            v-model="name"
            type="text"
            class="form-control"
            maxlength="100"
            placeholder="e.g. Soft Drinks"
            required
          />
        </div>
        <div class="mb-3">
          <label class="form-label" for="subcategory-description">Description</label>
          <textarea
            id="subcategory-description"
            v-model="description"
            class="form-control"
            rows="3"
            maxlength="500"
          ></textarea>
        </div>
        <div class="d-flex align-items-center justify-content-between">
          <label class="form-label mb-0" for="subcategory-status">Status</label>
          <div class="form-check form-switch mb-0">
            <input id="subcategory-status" v-model="active" class="form-check-input" type="checkbox" role="switch" />
            <label class="form-check-label" for="subcategory-status">{{ active ? 'Active' : 'Inactive' }}</label>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Saving…' : subcategory ? 'Save Changes' : 'Add Sub Category' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
