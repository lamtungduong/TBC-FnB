<script setup lang="ts">
const activeTab = ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>('sale')
provide('activeTab', activeTab)

const { isProcessing, isInitialLoad, lastLoadDurationMs } = usePosStore()
const showProcessingOverlay = computed(() => isProcessing.value && !isInitialLoad.value)

const route = useRoute()
// Trang order (self-checkout) hiện đang là route "/"
const isOrderPage = computed(() => route.path === '/')

// Nhận diện mobile / desktop bằng JS
const { isMobile, isDesktop } = useViewport()
provide('isMobile', isMobile)
provide('isDesktop', isDesktop)
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
      </div>
    </header>
    <main class="app-main">
      <NuxtPage />
      <div v-if="showProcessingOverlay" class="processing-overlay" aria-hidden="true" />
    </main>
  </div>
</template>

