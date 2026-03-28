

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Product } from '~/composables/usePosStore'

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' }
  ]
})

const {
  data,
  namedProducts,
  cartLines,
  cartTotal,
  loadData,
  prefetchAll,
  addToCart,
  updateCartQty,
  clearCart
} = usePosStore()

const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))

const step = ref<1 | 2>(1)

// ─── Payment state ────────────────────────────────────────────────────────────
/** Mô tả gắn vào QR, stable trong suốt một phiên thanh toán */
const qrDescription = ref('')
/** Snapshot số tiền tại thời điểm bấm "Tiếp theo" (không thay đổi theo cart) */
const qrAmountSnapshot = ref('0')
/** Trạng thái thanh toán */
const paymentStatus = ref<'idle' | 'pending' | 'success'>('idle')
/** Bộ đếm ngược (giây) hiển thị khi success */
const successCountdown = ref(10)

let pollIntervalId: ReturnType<typeof setInterval> | null = null
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null
let successTimerId: ReturnType<typeof setInterval> | null = null

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function stopPolling() {
  if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null }
  if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null }
}

async function checkPayment() {
  try {
    const res = await $fetch<{
      success: boolean
      data: {
        transactionInfos: Array<{
          description: string
          amount: string
          creditDebitIndicator: string
        }>
      }
    }>('/api/check-payment')

    if (!res?.success || !res?.data?.transactionInfos) return

    // Ngân hàng xóa ký tự đặc biệt trong addInfo khi lưu description
    // (vd: "TBC-FnB-Ab3xYz" → "TBCFnBAb3xYz") → cần normalize trước khi so
    const normalizeDesc = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    const searchToken = normalizeDesc(qrDescription.value)

    const matched = res.data.transactionInfos.find(
      (tx) =>
        tx.creditDebitIndicator === 'CRDT' &&
        normalizeDesc(tx.description).includes(searchToken) &&
        Number(tx.amount) === Number(qrAmountSnapshot.value)
    )

    if (matched) {
      stopPolling()
      await saveOrderAndNotify()
    }
  } catch {
    // Lỗi mạng tạm thời – bỏ qua, poll lại lần sau
  }
}

async function saveOrderAndNotify() {
  // Lưu đơn hàng vào DB
  try {
    await $fetch('/api/checkout', {
      method: 'POST',
      body: {
        items: cartLines.value.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          price: l.price
        })),
        description: qrDescription.value
      }
    })
  } catch {
    // Nếu lưu lỗi thì vẫn hiện thành công để không block UX
  }

  // Phát nhạc
  if (typeof window !== 'undefined') {
    try {
      const audio = new Audio('/media/Thanh_to%C3%A1n_th%C3%A0nh_c%C3%B4ng.mp3')
      audio.play().catch(() => {})
    } catch {}
  }

  // Hiện UI thành công + đếm ngược 10s rồi refresh
  paymentStatus.value = 'success'
  successCountdown.value = 10
  successTimerId = setInterval(() => {
    successCountdown.value -= 1
    if (successCountdown.value <= 0) {
      clearInterval(successTimerId!)
      location.reload()
    }
  }, 1000)
}

function startPaymentPolling() {
  paymentStatus.value = 'pending'
  // Poll mỗi 2s
  pollIntervalId = setInterval(checkPayment, 2000)
  // Timeout sau 120s -> refresh
  pollTimeoutId = setTimeout(() => {
    stopPolling()
    location.reload()
  }, 120_000)
}
// ─────────────────────────────────────────────────────────────────────────────

function displayPrice(value: number) {
  return value.toLocaleString('vi-VN')
}

const { getApiUrl } = useApiOrigin()
function productImageUrl(p: Product) {
  if (!p.image) return ''
  if (p.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(p.id)] ?? 0
    return getApiUrl(`/api/blob-image?url=${encodeURIComponent(p.image)}&_t=${t}`)
  }
  return p.image.startsWith('http') ? p.image : ''
}

const qtyByProductId = computed<Record<number, number>>(() => {
  const result: Record<number, number> = {}
  for (const line of cartLines.value) {
    result[line.productId] = line.qty
  }
  return result
})

function selectedQty(productId: number) {
  return qtyByProductId.value[productId] ?? 0
}

function productStock(productId: number): number {
  const p = data.value.products.find((x) => x.id === productId)
  return p ? p.stock : 0
}

function isProductDisabled(p: { id: number; stock: number }): boolean {
  const inCart = selectedQty(p.id)
  return p.stock === 0 || inCart >= p.stock
}

function isPlusDisabledInCart(line: { productId: number; qty: number }): boolean {
  return line.qty >= productStock(line.productId)
}

const qrAmount = computed(() => String(cartTotal.value || 0))

let lastTouchEnd = 0
let touchEndHandler: ((event: TouchEvent) => void) | null = null

function goNext() {
  if (!cartLines.value.length) return
  // Tạo mô tả mới & snapshot số tiền
  qrDescription.value = `TBC-FnB-${generateRandomString(6)}`
  qrAmountSnapshot.value = qrAmount.value
  step.value = 2
  startPaymentPolling()
}

function cancelOrder() {
  stopPolling()
  if (successTimerId) { clearInterval(successTimerId); successTimerId = null }
  paymentStatus.value = 'idle'
  clearCart()
  step.value = 1
}

onMounted(async () => {
  // Trang order chỉ cần dữ liệu tab Bán hàng -> load tối thiểu products
  await loadData('sale')

  // Sau khi load xong products, prefetch nền cho các phần dữ liệu còn lại
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      prefetchAll()
    }, 0)
  }

  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('kiosk-mode')
  }

  if (typeof window !== 'undefined' && 'navigator' in window && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 1) {
    touchEndHandler = (event: TouchEvent) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) {
        event.preventDefault()
      }
      lastTouchEnd = now
    }

    document.addEventListener('touchend', touchEndHandler, { passive: false })
  }
})

onBeforeUnmount(() => {
  stopPolling()
  if (successTimerId) { clearInterval(successTimerId); successTimerId = null }

  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('kiosk-mode')
  }

  if (touchEndHandler) {
    document.removeEventListener('touchend', touchEndHandler)
    touchEndHandler = null
  }
})
</script>

<template>
  <div class="order-page">
    <!-- Card 1: Chọn sản phẩm -->
    <section
      v-if="step === 1"
      class="card order-card"
    >
      <div class="order-card-header">
        <h3 class="order-card-title">
          Chọn sản phẩm
        </h3>
        <button
          type="button"
          class="btn btn-primary"
          :class="{ disabled: !cartLines.length }"
          :disabled="!cartLines.length"
          @click="goNext"
        >
          Tiếp theo
        </button>
      </div>
      <div class="order-product-list">
        <button
          v-for="p in namedProducts"
          :key="p.id"
          type="button"
          class="order-product-item"
          :class="{ 'order-product-item-disabled': isProductDisabled(p) }"
          :disabled="isProductDisabled(p)"
          @click="!isProductDisabled(p) && addToCart(p.id)"
        >
          <div class="order-product-thumb">
            <img
              v-if="p.image"
              :key="'p-' + p.id + '-' + (blobImageVersions[String(p.id)] ?? 0)"
              :src="productImageUrl(p)"
              :alt="p.name"
            />
            <span v-else>Không có ảnh</span>
          </div>
          <div class="order-product-info">
            <div class="order-product-name">
              {{ p.name }}
            </div>
            <span class="order-product-price">
              {{ displayPrice(p.price) }} đ
            </span>
            <div
              v-if="selectedQty(p.id) > 0"
              class="order-product-qty-row"
            >
              <button
                type="button"
                class="btn btn-default btn-xs"
                @click.stop="updateCartQty(p.id, -1)"
              >
                -
              </button>
              <span class="order-product-qty-value">
                {{ selectedQty(p.id) }}
              </span>
              <button
                type="button"
                class="btn btn-default btn-xs"
                :disabled="selectedQty(p.id) >= p.stock"
                :class="{ 'order-btn-plus-disabled': selectedQty(p.id) >= p.stock }"
                @click.stop="selectedQty(p.id) < p.stock && addToCart(p.id)"
              >
                +
              </button>
            </div>
          </div>
        </button>

        <div
          v-if="!namedProducts.length"
          class="text-muted order-empty-products"
        >
          Chưa có sản phẩm. Vào tab <b>Sản phẩm</b> để khai báo.
        </div>
      </div>
    </section>

    <!-- Card 2: Đơn hàng -->
    <section
      v-else
      class="card order-card"
    >
      <div class="order-card-header">
        <h3 class="order-card-title">
          Đơn hàng
        </h3>
        <button
          type="button"
          class="btn btn-secondary"
          @click="cancelOrder"
        >
          Hủy bỏ
        </button>
      </div>

      <div class="order-cart-table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 50px;">STT</th>
              <th>Tên hàng</th>
              <th
                style="width: 90px;"
                class="text-right"
              >
                Giá bán
              </th>
              <th
                style="width: 100px;"
                class="text-right"
              >
                Số lượng
              </th>
              <th
                style="width: 110px;"
                class="text-right"
              >
                Thành tiền
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, idx) in cartLines"
              :key="line.productId"
            >
              <td>{{ idx + 1 }}</td>
              <td>{{ line.name }}</td>
              <td class="text-right">
                {{ displayPrice(line.price) }}
              </td>
              <td class="text-right">
                <div class="order-qty-control">
                  <button
                    type="button"
                    class="btn btn-default btn-xs"
                    @click="updateCartQty(line.productId, -1)"
                  >
                    -
                  </button>
                  <span class="order-qty-value">
                    {{ line.qty }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-default btn-xs"
                    :disabled="isPlusDisabledInCart(line)"
                    :class="{ 'order-btn-plus-disabled': isPlusDisabledInCart(line) }"
                    @click="!isPlusDisabledInCart(line) && updateCartQty(line.productId, 1)"
                  >
                    +
                  </button>
                </div>
              </td>
              <td class="text-right">
                {{ displayPrice(line.lineTotal) }}
              </td>
            </tr>
            <tr v-if="!cartLines.length">
              <td
                colspan="5"
                class="text-muted"
              >
                Chưa có sản phẩm trong đơn hàng.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="order-summary">
        <div class="order-summary-content">
          <div class="order-summary-label">
            Tổng tiền hàng
          </div>
          <div class="order-summary-value">
            {{ displayPrice(cartTotal) }} đ
          </div>
        </div>
      </div>

      <div
        v-if="cartTotal"
        class="order-qr"
      >
        <br>
        <div class="order-qr-label">
          Vui lòng quét mã QR sau để thanh toán
        </div>
        <img
          :src="`https://img.vietqr.io/image/TPB-01720825555-compact.png?amount=${qrAmountSnapshot}&addInfo=${encodeURIComponent(qrDescription)}`"
          alt="QR thanh toán"
          :class="{ 'order-qr-img-success': paymentStatus === 'success' }"
        >
        <div
          v-if="paymentStatus === 'success'"
          class="order-payment-success"
        >
          <span class="order-payment-success-icon">✓</span>
          Thanh toán thành công! Xin cảm ơn!
          <span class="order-payment-success-countdown">
            Trang sẽ làm mới sau {{ successCountdown }}s...
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  max-height: 100%;
  padding: 15px 15px;
  touch-action: manipulation;
  user-select: none;
}

.order-header {
  text-align: center;
}

.order-title {
  font-size: 16px;
  font-weight: 600;
}

.order-card {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  flex: 1;
  min-height: 0;
}

.order-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}

.order-card-title {
  margin: 0 0 8px;
  font-size: 21px;
}

.order-product-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.order-product-item {
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  padding: 4px;
  background: white;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  cursor: pointer;
  text-align: center;
  min-height: 125px;
}

.order-product-item:hover {
  background: #f3f4f6;
}

.order-product-item-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.order-product-item-disabled:hover {
  background: white;
}
.order-btn-plus-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.order-product-thumb {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  overflow: hidden;
  background: #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #6b7280;
  margin: 0 auto;
}

.order-product-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.order-product-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.order-product-name {
  font-size: 12px;
  font-weight: 600;
}

.order-product-price {
  color: #2563eb;
  font-weight: 600;
  font-size: 11px;
}

.order-product-qty {
  color: #374151;
}

.order-product-qty-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.order-product-qty-label {
  color: #6b7280;
}

.order-product-qty-value {
  min-width: 20px;
  text-align: center;
}

.order-empty-products {
  grid-column: 1 / -1;
  font-size: 12px;
}

.order-card-footer {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.order-cart-table-wrapper {
  flex: 1;
  min-height: 0;
  max-height: 100%;
  overflow: auto;
}

.order-qty-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.order-qty-value {
  min-width: 24px;
  display: inline-block;
  text-align: center;
}

.order-summary {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.order-summary-content {
  text-align: right;
}

.order-summary-label {
  font-size: 13px;
}

.order-summary-value {
  font-size: 18px;
  font-weight: 700;
  color: #2563eb;
}

.order-qr {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.order-qr-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.order-qr img {
  max-width: 220px;
  width: 100%;
  height: auto;
  transition: opacity 0.3s ease;
}

.order-qr-img-success {
  opacity: 0.35;
}

.order-payment-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 20px;
  font-weight: 700;
  color: #16a34a;
  animation: payment-success-pop 0.4s ease;
}

.order-payment-success-icon {
  font-size: 48px;
  line-height: 1;
}

.order-payment-success-countdown {
  font-size: 13px;
  font-weight: 400;
  color: #6b7280;
}

@keyframes payment-success-pop {
  0%   { transform: scale(0.7); opacity: 0; }
  70%  { transform: scale(1.08); }
  100% { transform: scale(1);   opacity: 1; }
}

@media (max-width: 480px) {
  .order-page {
    height: 100%;
    max-height: 100%;
    padding: 15px 15px;
  }

  .order-title {
    font-size: 14px;
  }

  .order-product-list {
    gap: 4px;
  }

  .order-product-thumb {
    width: 56px;
    height: 56px;
  }
}
</style>

