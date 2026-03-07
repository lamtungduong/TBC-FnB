<script setup lang="ts">
const activeTab = inject<Ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>>('activeTab')!
const { loadData } = usePosStore()

onMounted(() => {
  loadData()
})
</script>

<template>
  <div>
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

