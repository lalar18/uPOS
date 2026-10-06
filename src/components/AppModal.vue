<script setup lang="ts">
// Bootstrap-styled modal driven by Vue (no Bootstrap JS). Render it with v-if.
// There's no X in the header: every modal needs its own Cancel / Close button in the footer.
// Escape and clicking the backdrop also close it.
import { onBeforeUnmount, onMounted } from 'vue'

withDefaults(defineProps<{ title: string; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
const emit = defineEmits<{ close: [] }>()

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.body.classList.add('modal-open') // stops the page behind from scrolling
  document.addEventListener('keydown', closeOnEscape)
})

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open')
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal fade show d-block" tabindex="-1" role="dialog" aria-modal="true" @click.self="emit('close')">
      <div class="modal-dialog modal-dialog-centered" :class="size !== 'md' && `modal-${size}`">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">{{ title }}</h4>
          </div>
          <slot />
        </div>
      </div>
    </div>
    <div class="modal-backdrop fade show"></div>
  </Teleport>
</template>
