<script setup lang="ts">
const activeTab = ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>('sale')
provide('activeTab', activeTab)
const { isProcessing, isInitialLoad, processingStartTime, lastLoadDurationMs } = usePosStore()
const showProcessingOverlay = computed(() => isProcessing.value && !isInitialLoad.value)

const route = useRoute()
const isOrderPage = computed(() => route.path === '/order')

// Hiển thị thời gian: đang xử lý = elapsed, xong = last duration
const loadTimeDisplay = ref<string>('')
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.round(ms)} ms`
}

watch(
  [isProcessing, processingStartTime, lastLoadDurationMs],
  () => {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
    const startTime = processingStartTime.value
    const lastDuration = lastLoadDurationMs.value
    if (isProcessing.value && startTime != null) {
      const update = () => {
        loadTimeDisplay.value = formatDuration(Date.now() - startTime)
      }
      update()
      elapsedTimer = setInterval(update, 100)
    } else if (lastDuration != null) {
      loadTimeDisplay.value = formatDuration(lastDuration)
    } else {
      loadTimeDisplay.value = ''
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
})
</script>

<template>
  <div class="app-root" :class="{ 'is-processing': showProcessingOverlay }">
    <header class="app-header">
      <template v-if="isOrderPage">
        <div class="app-title">
          The Barbell Club - Fridge Self-checkout
        </div>
      </template>
      <template v-else>
        <div class="app-title">TBC - FnB</div>
        <div class="tab-bar">
          <button
            class="tab-button"
            :class="{ active: activeTab === 'sale' }"
            @click="activeTab = 'sale'"
          >
            Bán hàng
          </button>
          <button
            class="tab-button"
            :class="{ active: activeTab === 'products' }"
            @click="activeTab = 'products'"
          >
            Sản phẩm
          </button>
          <button
            class="tab-button"
            :class="{ active: activeTab === 'purchase' }"
            @click="activeTab = 'purchase'"
          >
            Nhập hàng
          </button>
          <button
            class="tab-button"
            :class="{ active: activeTab === 'orders' }"
            @click="activeTab = 'orders'"
          >
            Đơn hàng
          </button>
          <button
            class="tab-button"
            :class="{ active: activeTab === 'report' }"
            @click="activeTab = 'report'"
          >
            Báo cáo
          </button>
        </div>
        <div v-if="loadTimeDisplay" class="app-header-duration" aria-label="Thời gian xử lý">
          {{ loadTimeDisplay }}
        </div>
      </template>
    </header>
    <main class="app-main">
      <NuxtPage />
      <div v-if="showProcessingOverlay" class="processing-overlay" aria-hidden="true" />
    </main>
  </div>
</template>

