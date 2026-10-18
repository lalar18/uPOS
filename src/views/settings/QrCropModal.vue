<script setup lang="ts">
// Crops a GCash QR screenshot down to just the QR code before it's uploaded, so the POS shows a big,
// clean code that scans easily. Square by default (QR codes are square); "Free" allows any shape,
// e.g. to keep the account name printed under the code. Zoom and rotate straighten a tilted photo.
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { onBeforeUnmount, ref } from 'vue'
import { MAX_QR_SIDE, qrCanvasToBlob } from '@/api/gcash'
import AppModal from '@/components/AppModal.vue'

defineProps<{ src: string }>() // the image to crop (an object URL, or the saved QR's URL)
const emit = defineEmits<{ close: []; done: [image: Blob]; failed: [] }>() // failed: the image couldn't be read

const image = ref<HTMLImageElement | null>(null)
const square = ref(true)
const busy = ref(false)
const error = ref('')
let cropper: Cropper | null = null

// Called by the <img> once the image has loaded
function start() {
  if (!image.value) return
  cropper?.destroy()
  cropper = new Cropper(image.value, {
    aspectRatio: square.value ? 1 : NaN,
    viewMode: 1, // keep the crop box inside the image
    dragMode: 'move',
    autoCropArea: 0.8,
    background: false,
    toggleDragModeOnDblclick: false,
  })
}
onBeforeUnmount(() => cropper?.destroy())

const zoom = (ratio: number) => cropper?.zoom(ratio)
const rotate = (degrees: number) => cropper?.rotate(degrees)
const reset = () => cropper?.reset()

function setSquare(value: boolean) {
  square.value = value
  cropper?.setAspectRatio(value ? 1 : NaN)
}

async function done() {
  if (!cropper) return
  busy.value = true
  error.value = ''
  try {
    const canvas = cropper.getCroppedCanvas({
      maxWidth: MAX_QR_SIDE,
      maxHeight: MAX_QR_SIDE,
      fillColor: '#ffffff', // transparent parts and rotated corners stay white, so the QR reads
      imageSmoothingQuality: 'high',
    })
    emit('done', await qrCanvasToBlob(canvas))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not crop the image'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppModal title="Crop QR Code" @close="emit('close')">
    <div class="modal-body">
      <div v-if="error" class="alert alert-danger py-2" role="alert">{{ error }}</div>
      <p class="fs-13 text-gray-5 mb-2">
        Fit the box around the QR code only, leaving a little white border, so customers can scan it easily.
      </p>
      <div class="crop-area">
        <img ref="image" :src="src" alt="" @load="start" @error="emit('failed')" />
      </div>
      <div class="d-flex flex-wrap justify-content-center gap-2 mt-3">
        <div class="btn-group btn-group-sm" role="radiogroup" aria-label="Crop shape">
          <button
            type="button"
            role="radio"
            class="btn"
            :class="square ? 'btn-primary' : 'btn-light'"
            :aria-checked="square"
            @click="setSquare(true)"
          >
            <i class="ti ti-square me-1"></i>Square
          </button>
          <button
            type="button"
            role="radio"
            class="btn"
            :class="!square ? 'btn-primary' : 'btn-light'"
            :aria-checked="!square"
            @click="setSquare(false)"
          >
            <i class="ti ti-crop me-1"></i>Free
          </button>
        </div>
        <button type="button" class="btn btn-light btn-sm" title="Zoom in" @click="zoom(0.1)">
          <i class="ti ti-zoom-in"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Zoom out" @click="zoom(-0.1)">
          <i class="ti ti-zoom-out"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Rotate left" @click="rotate(-90)">
          <i class="ti ti-rotate"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Rotate right" @click="rotate(90)">
          <i class="ti ti-rotate-clockwise"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Straighten a little" @click="rotate(-2)">
          <i class="ti ti-arrow-back-up"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Straighten a little" @click="rotate(2)">
          <i class="ti ti-arrow-forward-up"></i>
        </button>
        <button type="button" class="btn btn-light btn-sm" title="Start over" @click="reset">
          <i class="ti ti-refresh"></i>
        </button>
      </div>
      <p class="fs-12 text-gray-5 text-center mt-2 mb-0">
        Drag the image to move it, drag the box corners to resize, scroll or pinch to zoom.
      </p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">Cancel</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="done">
        {{ busy ? 'Cropping…' : 'Use This QR' }}
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
.crop-area {
  height: 360px;
  background: #f7f7f7;
  border-radius: 8px;
  overflow: hidden;
}

/* Cropper needs the image to be block-level and constrained */
.crop-area img {
  display: block;
  max-width: 100%;
}

.crop-area :deep(.cropper-view-box) {
  outline: 2px solid #fe9f43;
}

@media (max-width: 575.98px) {
  .crop-area {
    height: 300px;
  }
}
</style>
