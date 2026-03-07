<script setup lang="ts">
const activeTab = ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>('sale')
provide('activeTab', activeTab)
const { isProcessing } = usePosStore()
</script>

<template>
  <div class="app-root" :class="{ 'is-processing': isProcessing }">
    <header class="app-header">
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
    </header>
    <main class="app-main">
      <NuxtPage />
      <div v-if="isProcessing" class="processing-overlay" aria-hidden="true" />
    </main>
  </div>
</template>

