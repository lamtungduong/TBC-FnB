import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useViewport() {
  const width = ref<number>(0)

  function update() {
    if (typeof window === 'undefined') return
    width.value = window.innerWidth
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('resize', update)
  })

  const isMobile = computed(() => width.value > 0 && width.value <= 768)
  const isDesktop = computed(() => width.value > 1024)

  return {
    width,
    isMobile,
    isDesktop
  }
}

