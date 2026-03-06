<script setup lang="ts">
// Catch-all: khi có thứ gì (vd extension, dev tool) navigate tới /api/xxx,
// Vue Router sẽ match route này thay vì báo "No match found".
// API thật được xử lý bởi server (server/api/), không qua router.
onMounted(() => {
  navigateTo('/', { replace: true })
})
</script>

<template>
  <div />
</template>
