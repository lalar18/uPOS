<script setup lang="ts">
// Picks and orders the widgets on a dashboard. Used for your own dashboard, and by admins
// for another user's (pass `lockable` to also choose whether that user may change it).
import { computed, ref } from 'vue'
import type { DashboardLayout } from '@/api/dashboard'
import AppModal from '@/components/AppModal.vue'
import { widgetsFor } from './widgets'

const props = defineProps<{
  title: string
  load: () => Promise<DashboardLayout>
  save: (widgets: string[] | null, locked: boolean) => Promise<DashboardLayout>
  lockable?: boolean // admins editing someone else's dashboard
  userName?: string // whose dashboard, for the lock switch
}>()
const emit = defineEmits<{ close: []; saved: [layout: DashboardLayout] }>()

const layout = ref<DashboardLayout | null>(null)
const selected = ref<string[]>([])
const locked = ref(false)
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saving = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    layout.value = await props.load()
    selected.value = [...layout.value.widgets]
    locked.value = layout.value.locked
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not load the dashboard'
  } finally {
    loading.value = false
  }
}
load()

const shown = computed(() => widgetsFor(selected.value))
const hidden = computed(() => widgetsFor((layout.value?.available ?? []).filter((k) => !selected.value.includes(k))))
const isDefault = computed(() => JSON.stringify(selected.value) === JSON.stringify(layout.value?.available ?? []))

function move(index: number, by: -1 | 1) {
  const list = [...selected.value]
  const [item] = list.splice(index, 1)
  list.splice(index + by, 0, item!)
  selected.value = list
}

const remove = (key: string) => (selected.value = selected.value.filter((k) => k !== key))
const add = (key: string) => (selected.value = [...selected.value, key])
const resetToDefault = () => (selected.value = [...(layout.value?.available ?? [])])

async function submit() {
  saveError.value = ''
  saving.value = true
  try {
    // The default set is saved as "default", so widgets added to the app later show up too
    const saved = await props.save(isDefault.value ? null : selected.value, locked.value)
    emit('saved', saved)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not save the dashboard'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal :title="title" size="lg" @close="emit('close')">
    <form novalidate @submit.prevent="submit">
      <div class="modal-body">
        <div v-if="loadError" class="alert alert-danger py-2 d-flex align-items-center justify-content-between gap-2">
          {{ loadError }}
          <button type="button" class="btn btn-sm btn-outline-danger" @click="load">Retry</button>
        </div>
        <div v-if="saveError" class="alert alert-danger py-2" role="alert">{{ saveError }}</div>
        <div v-if="loading" class="text-center text-gray-5 py-5">Loading…</div>

        <template v-else-if="layout">
          <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
            <h6 class="mb-0">On the dashboard <span class="text-gray-5 fw-normal">({{ shown.length }})</span></h6>
            <button type="button" class="btn btn-sm btn-link p-0" :disabled="isDefault" @click="resetToDefault">
              <i class="ti ti-restore me-1"></i>Reset to default
            </button>
          </div>
          <div v-if="shown.length === 0" class="empty-box mb-3">
            No widgets. The dashboard will be empty; add some from the list below.
          </div>
          <ul v-else class="widget-pick-list mb-4">
            <li v-for="(widget, i) in shown" :key="widget.key">
              <span class="pick-icon"><i class="ti" :class="`ti-${widget.icon}`"></i></span>
              <div class="min-w-0 flex-grow-1">
                <div class="fw-medium text-gray-9">{{ widget.title }}</div>
                <div class="fs-12 text-gray-5">{{ widget.description }}</div>
              </div>
              <div class="pick-actions">
                <button type="button" :disabled="i === 0" :aria-label="`Move ${widget.title} up`" @click="move(i, -1)">
                  <i class="ti ti-chevron-up"></i>
                </button>
                <button
                  type="button"
                  :disabled="i === shown.length - 1"
                  :aria-label="`Move ${widget.title} down`"
                  @click="move(i, 1)"
                >
                  <i class="ti ti-chevron-down"></i>
                </button>
                <button type="button" class="remove" :aria-label="`Remove ${widget.title}`" @click="remove(widget.key)">
                  <i class="ti ti-x"></i>
                </button>
              </div>
            </li>
          </ul>

          <h6 class="mb-2">Available <span class="text-gray-5 fw-normal">({{ hidden.length }})</span></h6>
          <div v-if="hidden.length === 0" class="empty-box">Every widget is on the dashboard.</div>
          <ul v-else class="widget-pick-list">
            <li v-for="widget in hidden" :key="widget.key">
              <span class="pick-icon muted"><i class="ti" :class="`ti-${widget.icon}`"></i></span>
              <div class="min-w-0 flex-grow-1">
                <div class="fw-medium text-gray-9">{{ widget.title }}</div>
                <div class="fs-12 text-gray-5">{{ widget.description }}</div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-primary flex-shrink-0" @click="add(widget.key)">
                <i class="ti ti-plus me-1"></i>Add
              </button>
            </li>
          </ul>
          <p class="fs-12 text-gray-5 mt-2 mb-0">
            Widgets that show cost prices only appear for roles that can manage products.
          </p>

          <div v-if="lockable" class="d-flex align-items-start justify-content-between gap-3 mt-4 pt-3 border-top">
            <div>
              <label class="form-label mb-0" for="dashboard-unlocked">Let {{ userName ?? 'this user' }} change it</label>
              <div class="form-text mt-0">
                {{
                  locked
                    ? 'Locked: they see only these widgets and cannot add or remove any.'
                    : 'They can add, remove and reorder their own widgets.'
                }}
              </div>
            </div>
            <div class="form-check form-switch mb-0 flex-shrink-0">
              <input
                id="dashboard-unlocked"
                :checked="!locked"
                class="form-check-input"
                type="checkbox"
                role="switch"
                @change="locked = !($event.target as HTMLInputElement).checked"
              />
            </div>
          </div>
        </template>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving || loading || !layout">
          {{ saving ? 'Saving…' : 'Save Dashboard' }}
        </button>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.widget-pick-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #e6eaed;
  border-radius: 8px;
}

.widget-pick-list > li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}

.widget-pick-list > li + li {
  border-top: 1px solid #e6eaed;
}

.pick-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(254, 159, 67, 0.12);
  color: #fe9f43;
  font-size: 17px;
}

.pick-icon.muted {
  background: #f2f4f6;
  color: #646b72;
}

.pick-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.pick-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #e6eaed;
  border-radius: 6px;
  background: #ffffff;
  color: #646b72;
  font-size: 16px;
}

.pick-actions button:hover:not(:disabled) {
  border-color: #fe9f43;
  color: #fe9f43;
}

.pick-actions button.remove:hover {
  border-color: #ff0000;
  color: #ff0000;
}

.pick-actions button:disabled {
  opacity: 0.35;
}

.empty-box {
  padding: 16px;
  border: 1px dashed #d5dadf;
  border-radius: 8px;
  color: #646b72;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 575.98px) {
  .widget-pick-list > li {
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .widget-pick-list > li .min-w-0 {
    flex-basis: calc(100% - 44px);
  }

  .pick-actions,
  .widget-pick-list > li > .btn {
    margin-left: 44px;
  }
}
</style>
