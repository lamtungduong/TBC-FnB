<script setup lang="ts">
const activeTab = ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>('sale')
provide('activeTab', activeTab)

const { isProcessing, isInitialLoad, lastLoadDurationMs } = usePosStore()
const { public: { appVersion } } = useRuntimeConfig()
const showProcessingOverlay = computed(() => isProcessing.value && !isInitialLoad.value)

const route = useRoute()
// Trang order (self-checkout) hiện đang là route "/"
const isOrderPage = computed(() => route.path === '/')

// Nhận diện mobile / desktop bằng JS
const { isMobile, isDesktop } = useViewport()
provide('isMobile', isMobile)
provide('isDesktop', isDesktop)

function handleRefreshClick() {
  // Clear localStorage and sessionStorage
  localStorage.clear()
  sessionStorage.clear()

  // Clear service worker cache
  if (typeof window !== 'undefined' && 'caches' in window) {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        caches.delete(cacheName)
      })
    })
  }

  // Reload page
  location.reload()
}
</script>

<template>
  <div class="app-root" :class="{ 'is-processing': showProcessingOverlay }">
    <header class="app-header" :class="{ 'app-header-order': isOrderPage }">
      <div class="app-header-inner">
        <div class="app-header-left">
        <template v-if="isOrderPage">
          <div class="app-title">
            The Barbell Club - Self-checkout Fridge
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
        </template>
        </div>

        <div class="app-header-right">
          <div v-if="!isOrderPage" class="app-header-version">Ver: {{ appVersion }}</div>

          <div
            v-if="!isOrderPage && !isMobile && lastLoadDurationMs != null"
            class="app-header-status"
          >
            Page load time:
            <span v-if="lastLoadDurationMs < 1000">
              {{ Number(lastLoadDurationMs) }}ms
            </span>
            <span v-else>
              {{ (lastLoadDurationMs / 1000).toFixed(2) }}s
            </span>
          </div>

          <button
            type="button"
            class="app-header-refresh"
            title="Clear cache and reload"
            @click="handleRefreshClick"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>
    </header>
    <main class="app-main">
      <NuxtPage />
      <div v-if="showProcessingOverlay" class="processing-overlay" aria-hidden="true" />
    </main>
  </div>
</template>

