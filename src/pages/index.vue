<script setup lang="ts">
const activeTab = ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>('sale')
const { loadData } = usePosStore()

onMounted(() => {
  loadData()
})
</script>

<template>
  <div>
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

    <div v-if="activeTab === 'sale'">
      <SaleTab />
    </div>
    <div v-else-if="activeTab === 'products'">
      <ProductsTab />
    </div>
    <div v-else-if="activeTab === 'purchase'">
      <PurchaseTab />
    </div>
    <div v-else-if="activeTab === 'orders'">
      <OrdersTab />
    </div>
    <div v-else>
      <ReportTab />
    </div>
  </div>
</template>

