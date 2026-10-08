// Loads one widget's numbers, reloading whenever its params change.
import { ref, watch } from 'vue'
import { getWidget } from '@/api/dashboard'

export function useWidget<T>(key: string, params: () => Record<string, string> = () => ({})) {
  const data = ref<T | null>(null)
  const loading = ref(false)
  const error = ref('')
  let latestRequest = 0

  async function load() {
    const requestId = ++latestRequest
    loading.value = true
    error.value = ''
    try {
      const result = await getWidget<T>(key, params())
      if (requestId === latestRequest) data.value = result
    } catch (e) {
      if (requestId === latestRequest) error.value = e instanceof Error ? e.message : 'Could not load this widget'
    } finally {
      if (requestId === latestRequest) loading.value = false
    }
  }

  watch(params, load, { immediate: true, deep: true })
  return { data, loading, error, load }
}
