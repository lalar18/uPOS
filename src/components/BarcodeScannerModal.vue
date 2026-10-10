<script setup lang="ts">
// Reads barcodes and QR codes with the device's camera: the back camera on phones and
// tablets, the webcam on computers. It keeps scanning until closed so several items can be
// scanned in a row; onScan says what became of each code and the answer shows under the
// video. A code held in front of the camera counts once; take it away and back to scan it
// again. Codes can also be typed in, for labels the camera can't read.
//
// Decoding uses ZXing compiled to WebAssembly (the same on every browser). It's loaded only
// when the scanner first opens, from this site (not a CDN), which the CSP requires.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import type { BarcodeDetector as Detector, BarcodeFormat } from 'barcode-detector/ponyfill'
import AppModal from './AppModal.vue'

export interface ScanResult {
  ok: boolean
  message: string
}

const props = defineProps<{
  title?: string
  onScan: (code: string) => Promise<ScanResult>
}>()
const emit = defineEmits<{ close: [] }>()

const FORMATS: BarcodeFormat[] = [
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'itf',
  'data_matrix',
]
const SCAN_INTERVAL_MS = 120
const SAME_CODE_GAP_MS = 1500 // how long a code must be out of view before it scans again

const video = ref<HTMLVideoElement | null>(null)
const starting = ref(true)
const cameraError = ref('')
const cameras = ref<MediaDeviceInfo[]>([])
const cameraId = ref('')
const result = ref<ScanResult | null>(null)
const busy = ref(false)
const flash = ref(false)
const typedCode = ref('')

let stream: MediaStream | null = null
let detector: Detector | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
let lastCode = ''
let lastSeenAt = 0

let detectorPromise: Promise<Detector> | null = null
function loadDetector(): Promise<Detector> {
  detectorPromise ??= import('barcode-detector/ponyfill').then(({ BarcodeDetector, prepareZXingModule }) => {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      },
    })
    return new BarcodeDetector({ formats: FORMATS })
  })
  return detectorPromise
}

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.'
  return e instanceof Error ? e.message : 'Could not start the camera.'
}

function stopCamera() {
  clearTimeout(timer)
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

async function startCamera() {
  stopCamera()
  starting.value = true
  cameraError.value = ''
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser can’t use the camera here. Open the site over https in an up-to-date browser.')
    }
    const camera: MediaTrackConstraints = cameraId.value
      ? { deviceId: { exact: cameraId.value } }
      : { facingMode: { ideal: 'environment' } }
    const [newStream, newDetector] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...camera, width: { ideal: 1280 }, height: { ideal: 720 } },
      }),
      loadDetector(),
    ])
    if (closed) {
      newStream.getTracks().forEach((track) => track.stop())
      return
    }
    stream = newStream
    detector = newDetector
    await nextTick()
    if (!video.value) return
    video.value.srcObject = stream
    await video.value.play()
    await listCameras()
    scheduleScan()
  } catch (e) {
    if (!closed) cameraError.value = cameraErrorMessage(e)
  } finally {
    starting.value = false
  }
}

/** The device's cameras, once permission is granted (before that they have no labels) */
async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  cameras.value = devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
  const current = stream?.getVideoTracks()[0]?.getSettings().deviceId
  if (current) cameraId.value = current
}

function scheduleScan() {
  clearTimeout(timer)
  if (!closed && stream) timer = setTimeout(scanFrame, SCAN_INTERVAL_MS)
}

async function scanFrame() {
  const el = video.value
  if (!detector || !el || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || busy.value) {
    scheduleScan()
    return
  }
  try {
    const codes = await detector.detect(el)
    const code = codes.find((c) => c.rawValue.trim())?.rawValue.trim()
    const now = Date.now()
    if (code) {
      const repeat = code === lastCode && now - lastSeenAt < SAME_CODE_GAP_MS
      lastCode = code
      lastSeenAt = now
      if (!repeat) await submit(code)
    }
  } catch {
    // A frame that can't be read; try the next one
  }
  scheduleScan()
}

async function submit(code: string) {
  busy.value = true
  let answer: ScanResult
  try {
    answer = await props.onScan(code)
  } catch (e) {
    answer = { ok: false, message: e instanceof Error ? e.message : 'Something went wrong' }
  } finally {
    busy.value = false
  }
  result.value = answer
  signal(answer.ok)
}

async function submitTyped() {
  const code = typedCode.value.trim()
  if (!code || busy.value) return
  await submit(code)
  if (result.value?.ok) typedCode.value = ''
}

// A beep (higher when added, lower when not), a buzz on phones and a flash of the frame
let audio: AudioContext | null = null
function signal(ok: boolean) {
  flash.value = true
  setTimeout(() => (flash.value = false), 250)
  navigator.vibrate?.(ok ? 60 : [60, 60, 60])
  try {
    audio ??= new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = ok ? 1200 : 400
    gain.gain.value = 0.08
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + (ok ? 0.08 : 0.2))
  } catch {
    // No sound; the message still shows
  }
}

onMounted(startCamera)
onBeforeUnmount(() => {
  closed = true
  stopCamera()
  audio?.close().catch(() => {})
})
</script>

<template>
  <AppModal :title="title ?? 'Scan Barcode or QR Code'" @close="emit('close')">
    <div class="modal-body">
      <div class="viewfinder" :class="{ flash, failed: result && !result.ok }">
        <video ref="video" muted playsinline aria-label="Camera preview"></video>
        <div v-if="!cameraError" class="guide" aria-hidden="true"></div>
        <div v-if="starting" class="overlay-message">
          <span class="spinner-border spinner-border-sm me-2"></span>Starting camera…
        </div>
        <div v-else-if="cameraError" class="overlay-message flex-column gap-2 p-3 text-center">
          <i class="ti ti-camera-off fs-24"></i>
          <span>{{ cameraError }}</span>
          <button type="button" class="btn btn-sm btn-light" @click="startCamera">Try again</button>
        </div>
      </div>

      <p v-if="!cameraError" class="text-center text-gray-5 fs-13 mt-2 mb-0">
        Point the camera at a barcode or QR code. Keep scanning to add more.
      </p>

      <div
        v-if="result"
        class="alert py-2 mt-2 mb-0 d-flex align-items-center gap-2"
        :class="result.ok ? 'alert-success' : 'alert-warning'"
        role="status"
      >
        <i class="ti" :class="result.ok ? 'ti-circle-check' : 'ti-alert-triangle'"></i>
        <span class="text-break">{{ result.message }}</span>
      </div>

      <div v-if="cameras.length > 1" class="mt-3">
        <label class="form-label fs-13 mb-1" for="scanner-camera">Camera</label>
        <select id="scanner-camera" v-model="cameraId" class="form-select form-select-sm" @change="startCamera">
          <option v-for="(camera, index) in cameras" :key="camera.deviceId" :value="camera.deviceId">
            {{ camera.label || `Camera ${index + 1}` }}
          </option>
        </select>
      </div>

      <form class="mt-3" @submit.prevent="submitTyped">
        <label class="form-label fs-13 mb-1" for="scanner-code">Or type the code</label>
        <div class="input-group input-group-sm">
          <input
            id="scanner-code"
            v-model="typedCode"
            type="text"
            class="form-control"
            placeholder="Barcode or SKU"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary" :disabled="busy || !typedCode.trim()">Add</button>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-white border" @click="emit('close')">Done</button>
    </div>
  </AppModal>
</template>

<style scoped>
.viewfinder {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  background: #111827;
  overflow: hidden;
  transition: box-shadow 0.15s;
}

.viewfinder.flash {
  box-shadow: 0 0 0 4px #3eb780;
}

.viewfinder.flash.failed {
  box-shadow: 0 0 0 4px #fe9f43;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* A frame to aim with; wide enough for long 1D barcodes, tall enough for QR codes */
.guide {
  position: absolute;
  inset: 20% 12%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.overlay-message {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 14px;
}
</style>
