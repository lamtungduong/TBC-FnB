<script setup lang="ts">
const activeTab = inject<Ref<'sale' | 'products' | 'purchase' | 'orders' | 'report'>>('activeTab')!
const { loadData } = usePosStore()

/**
 * Nếu đang chạy trên domain Vercel (B) và client trong LAN truy cập
 * được máy chủ nội bộ (A), thì tự động redirect về (A).
 *
 * Bạn có thể bật/tắt tính năng này bằng cách đổi
 * giá trị ENABLE_LAN_REDIRECT bên dưới.
 *
 * Lưu ý: Check này phải chạy trên trình duyệt, vì server Vercel
 * không truy cập được IP LAN 192.168.10.x.
 */
const ENABLE_LAN_REDIRECT = false
const VERCEL_HOST = 'tbc-fnb.vercel.app'
const LAN_ORIGIN = 'http://192.168.10.197:3000'

async function checkAndRedirectToLan() {
  if (!ENABLE_LAN_REDIRECT) return
  if (import.meta.server) return

  const currentHost = window.location.hostname

  // Chỉ xử lý khi đang ở domain Vercel
  if (currentHost !== VERCEL_HOST) return

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500)

    // Dùng no-cors để chỉ kiểm tra kết nối mạng, không cần đọc response
    await fetch(LAN_ORIGIN, {
      mode: 'no-cors',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Nếu request không lỗi -> coi như server LAN đang sống -> redirect
    window.location.href = LAN_ORIGIN
  } catch {
    // Nếu không truy cập được LAN thì giữ nguyên trên Vercel
  }
}

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

onMounted(() => {
  // Thử chuyển sang server LAN nếu có
  checkAndRedirectToLan()

  // Nếu cookie khớp với mật khẩu hiện tại thì cho vào thẳng
  if (accessCookie.value === `ok:${PASSWORD}`) {
    isUnlocked.value = true
  } else {
    isUnlocked.value = false
  }

  loadData()
})

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
  <div>
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

