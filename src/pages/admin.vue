<script setup lang="ts">
import { inject, onMounted, ref, watch, type Ref } from 'vue'
import { usePosStore } from '~/composables/usePosStore'

const activeTab = inject<Ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>>('activeTab')!
const { loadData, prefetchAll } = usePosStore()
const { ensureLanChecked } = useApiOrigin()

/**
 * Cấu hình mật khẩu cho trang "/"
 *
 * - Đổi giá trị PASSWORD mỗi khi bạn muốn reset quyền truy cập.
 * - Khi PASSWORD thay đổi, client chỉ khi F5 / reload trang mới phải nhập lại (cookie cũ sẽ không còn hợp lệ).
 */
const PASSWORD = '000' // TODO: thay bằng mật khẩu thật
const PASSWORD_COOKIE_NAME = 'pos_root_access'
const PASSWORD_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 năm

const accessCookie = useCookie<string | null>(PASSWORD_COOKIE_NAME, {
  maxAge: PASSWORD_COOKIE_TTL_SECONDS,
  sameSite: 'lax',
})

const isUnlocked = ref(false)
const inputPassword = ref('')
const passwordError = ref('')

onMounted(async () => {
  // Khi vào từ Vercel: nếu tunnel (LAN) reachable thì API/ảnh sẽ gọi qua tunnel, URL vẫn giữ Vercel
  await ensureLanChecked()

  // Nếu cookie khớp với mật khẩu hiện tại thì cho vào thẳng
  if (accessCookie.value === `ok:${PASSWORD}`) {
    isUnlocked.value = true
  } else {
    isUnlocked.value = false
  }

  // Chỉ load dữ liệu tối thiểu cho tab hiện tại, các tab khác sẽ load khi được mở
  await loadData(activeTab.value)

  // Sau khi tab hiện tại đã load, prefetch nền cho các phần dữ liệu còn lại (không chặn render)
  if (import.meta.client) {
    setTimeout(() => {
      prefetchAll()
    }, 0)
  }
})

// Khi đổi tab, chỉ lúc đó mới load thêm phần dữ liệu cần cho tab mới (lazy theo tab)
watch(
  activeTab,
  (tab) => {
    loadData(tab)
  }
)

function submitPassword() {
  if (inputPassword.value === PASSWORD) {
    isUnlocked.value = true
    accessCookie.value = `ok:${PASSWORD}`
    passwordError.value = ''
  } else {
    passwordError.value = 'Mật khẩu không đúng. Vui lòng thử lại.'
  }
}
</script>

<template>
  <div class="admin-page">
    <div v-if="!isUnlocked" class="password-gate">
      <div class="password-gate-card">
        <h1 class="password-gate-title">Nhập mật khẩu</h1>
        <form
          class="password-gate-form"
          @submit.prevent="submitPassword"
        >
          <input
            v-model="inputPassword"
            class="field-input password-gate-input"
            type="password"
            placeholder="Mật khẩu"
            autocomplete="current-password"
          />
          <p v-if="passwordError" class="password-gate-error">
            {{ passwordError }}
          </p>
          <button class="btn btn-primary password-gate-button" type="submit">
            Tiếp tục
          </button>
        </form>
      </div>
    </div>

    <div v-else>
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
  </div>
</template>

<style scoped>
/* Tắt double-tap zoom trên mobile để thao tác nút/bảng không bị zoom */
.admin-page {
  touch-action: manipulation;
}
</style>

