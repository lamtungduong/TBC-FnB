<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Product } from '~/composables/usePosStore'

const {
  namedProducts,
  cartLines,
  cartTotal,
  loadData,
  addToCart,
  updateCartQty,
  clearCart
} = usePosStore()

const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))

const step = ref<1 | 2>(1)

function displayPrice(value: number) {
  return value.toLocaleString('vi-VN')
}

function productImageUrl(p: Product) {
  if (!p.image) return ''
  if (p.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(p.id)] ?? 0
    return `/api/blob-image?url=${encodeURIComponent(p.image)}&_t=${t}`
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

const qrAmount = computed(() => String(cartTotal.value || 0))

function goNext() {
  if (!cartLines.value.length) return
  step.value = 2
}

function cancelOrder() {
  clearCart()
  step.value = 1
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="order-page">
    <!-- Card 1: Chọn sản phẩm -->
    <section
      v-if="step === 1"
      class="card order-card"
    >
      <h3 class="order-card-title">
        Chọn sản phẩm
      </h3>
      <div class="order-product-list">
        <button
          v-for="p in namedProducts"
          :key="p.id"
          type="button"
          class="order-product-item"
          @click="addToCart(p.id)"
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
            <div class="order-product-row2">
              <span class="order-product-price">
                {{ displayPrice(p.price) }} đ
              </span>
              <span class="order-product-qty">
                Số lượng: {{ selectedQty(p.id) }}
              </span>
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

      <div class="order-card-footer">
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
    </section>

    <!-- Card 2: Đơn hàng -->
    <section
      v-else
      class="card order-card"
    >
      <h3 class="order-card-title">
        Đơn hàng
      </h3>

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
                    class="btn btn-ghost btn-xs"
                    @click="updateCartQty(line.productId, -1)"
                  >
                    -
                  </button>
                  <span class="order-qty-value">
                    {{ line.qty }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    @click="updateCartQty(line.productId, 1)"
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
        <div>
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
        <img
          :src="`https://img.vietqr.io/image/TPB-01720825555-qr_only.png?amount=${qrAmount}`"
          alt="QR thanh toán"
        >
      </div>

      <div class="order-card-footer">
        <button
          type="button"
          class="btn btn-secondary"
          @click="cancelOrder"
        >
          Hủy bỏ
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.order-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 480px;
  margin: 0 auto;
  height: 100%;
  max-height: 100%;
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

.order-card-title {
  margin: 0 0 8px;
  font-size: 14px;
}

.order-product-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  align-items: center;
  gap: 4px;
  cursor: pointer;
  text-align: center;
}

.order-product-item:hover {
  background: #f3f4f6;
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
}

.order-product-name {
  font-size: 12px;
  font-weight: 600;
}

.order-product-row2 {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}

.order-product-price {
  color: #2563eb;
  font-weight: 600;
}

.order-product-qty {
  color: #374151;
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
  justify-content: space-between;
  align-items: center;
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
  justify-content: center;
}

.order-qr img {
  max-width: 220px;
  width: 100%;
  height: auto;
}

@media (max-width: 480px) {
  .order-page {
    max-width: 100%;
    height: 100%;
    max-height: 100%;
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

