<script setup lang="ts">
import { computed } from 'vue'
import type { Product } from '~/composables/usePosStore'

const {
  data,
  namedProducts,
  cartLines,
  cartTotal,
  cartTotalAfterDiscount,
  cartTotalDiscount,
  noPayment,
  orderLineDiscounts,
  orderDiscountAmount,
  orderDiscountPercent,
  addToCart,
  updateCartQty,
  checkout,
  reorderProducts
} =
  usePosStore()
const { getApiUrl } = useApiOrigin()
const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))

let dragProductId: number | null = null

const qtyByProductId = computed<Record<number, number>>(() => {
  const result: Record<number, number> = {}
  for (const line of cartLines.value) {
    result[line.productId] = line.qty
  }
  return result
})

function productStock(productId: number): number {
  const p = data.value.products.find((x) => x.id === productId)
  return p ? p.stock : 0
}

function isProductDisabled(p: Product): boolean {
  const inCart = qtyByProductId.value[p.id] ?? 0
  return p.stock === 0 || inCart >= p.stock
}

function isPlusDisabled(line: { productId: number; qty: number }): boolean {
  return line.qty >= productStock(line.productId)
}

function displayPrice(value: number) {
  return value.toLocaleString('vi-VN')
}

const discountAmountOptions = computed(() => {
  const result: number[] = []
  for (let v = 1000; v <= 30000; v += 1000) {
    result.push(v)
  }
  return result
})

const discountPercentOptions = computed(() => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60])

const hasCartDiscount = computed(() => (Number(cartTotalDiscount.value) || 0) > 0)

function discountedUnitPrice(price: number, productId?: number): number {
  const perLine = productId != null ? orderLineDiscounts.value[productId] : undefined
  // Ép kiểu an toàn về số, mặc định 0 nếu không hợp lệ để tránh NaN
  const rawAmount = perLine?.amount ?? orderDiscountAmount
  const rawPercent = perLine?.percent ?? orderDiscountPercent
  const amount = Math.max(0, Number(rawAmount) || 0)
  const percent = Math.min(100, Math.max(0, Number(rawPercent) || 0))
  const base = Math.max(0, price - amount)
  if (percent <= 0) return base
  return Math.max(0, Math.round((base * (100 - percent)) / 100))
}

function getLineDiscountAmount(productId: number): number {
  return orderLineDiscounts.value[productId]?.amount ?? 0
}
function setLineDiscountAmount(productId: number, value: number) {
  const current = orderLineDiscounts.value[productId] ?? { amount: 0, percent: 0 }
  orderLineDiscounts.value[productId] = { ...current, amount: value }
}
function getLineDiscountPercent(productId: number): number {
  return orderLineDiscounts.value[productId]?.percent ?? 0
}
function setLineDiscountPercent(productId: number, value: number) {
  const current = orderLineDiscounts.value[productId] ?? { amount: 0, percent: 0 }
  orderLineDiscounts.value[productId] = { ...current, percent: value }
}

function productImageUrl(p: Product) {
  if (!p.image) return ''
  if (p.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(p.id)] ?? 0
    return getApiUrl(`/api/blob-image?url=${encodeURIComponent(p.image)}&_t=${t}`)
  }
  return p.image.startsWith('http') ? p.image : ''
}

function onDragStart(e: DragEvent, productId: number) {
  dragProductId = productId
  e.dataTransfer!.setData('text/plain', String(productId))
  e.dataTransfer!.effectAllowed = 'move'
  const wrap = (e.target as HTMLElement)?.closest?.('.product-item-wrap')
  wrap?.classList.add('product-item-dragging')
}

function onDragEnd(e: DragEvent) {
  dragProductId = null
  const wrap = (e.target as HTMLElement)?.closest?.('.product-item-wrap')
  wrap?.classList.remove('product-item-dragging')
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
}

function onDrop(e: DragEvent, dropIndex: number) {
  e.preventDefault()
  if (dragProductId == null) return
  const currentIds = namedProducts.value.map((p) => p.id)
  const fromIndex = currentIds.indexOf(dragProductId)
  if (fromIndex === -1) return
  const newOrder = [...currentIds]
  newOrder.splice(fromIndex, 1)
  // Insert at dropIndex: valid range 0..newOrder.length (append when dropIndex === length)
  const insertIndex = Math.min(dropIndex, newOrder.length)
  newOrder.splice(insertIndex, 0, dragProductId)
  reorderProducts(newOrder)
  dragProductId = null
}
</script>

<template>
  <div class="split-layout">
    <section class="card">
      <h3 style="margin: 0 0 8px; font-size: 14px;">Chọn sản phẩm</h3>
      <div
        class="product-list"
        @dragover="onDragOver"
      >
        <div
          v-for="(p, index) in namedProducts"
          :key="p.id"
          class="product-item-wrap"
          :class="{ 'product-item-disabled': isProductDisabled(p) }"
          :draggable="!isProductDisabled(p)"
          @dragstart="onDragStart($event, p.id)"
          @dragend="onDragEnd"
          @dragover="onDragOver"
          @drop="onDrop($event, index)"
        >
          <button
            class="product-item-button"
            type="button"
            :disabled="isProductDisabled(p)"
            @click="!isProductDisabled(p) && addToCart(p.id)"
          >
            <div class="product-thumb">
              <img
                v-if="p.image"
                :key="'p-' + p.id + '-' + (blobImageVersions[String(p.id)] ?? 0)"
                :src="productImageUrl(p)"
                :alt="p.name"
              />
              <span v-else>Không có ảnh</span>
            </div>
            <div class="product-info">
                <div class="product-name">{{ p.name }}</div>
                <div class="product-info-row2">
                  <span class="product-price">{{ displayPrice(p.price) }} đ</span>
                </div>
                <div class="product-stock-line">
                  <span class="product-stock">Kho: {{ p.stock.toLocaleString('vi-VN') }}</span>
                </div>
              </div>
          </button>
        </div>
        <!-- Vùng thả "cuối danh sách" khi kéo sản phẩm xuống cuối -->
        <div
          v-if="namedProducts.length"
          class="product-list-drop-tail"
          @dragover="onDragOver"
          @drop="onDrop($event, namedProducts.length)"
        />
        <div v-if="!namedProducts.length" class="text-muted" style="font-size: 13px;">
          Chưa có sản phẩm. Vào tab <b>Sản phẩm</b> để khai báo.
        </div>
      </div>
    </section>

    <section class="card">
      <h3 style="margin: 0 0 8px; font-size: 14px;">Đơn hàng hiện tại</h3>
      <div style="max-height: calc(100vh - 220px); overflow: auto;">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 50px;">STT</th>
              <th>Tên hàng</th>
              <th style="width: 110px;" class="text-right">Giá bán</th>
              <th style="width: 110px;" class="text-right">Giảm giá</th>
              <th style="width: 110px;" class="text-right">Giảm giá %</th>
              <th style="width: 140px;" class="text-right">Giá bán sau giảm</th>
              <th style="width: 130px;" class="text-right">Số lượng</th>
              <th style="width: 130px;" class="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, idx) in cartLines" :key="line.productId">
              <td>{{ idx + 1 }}</td>
              <td>{{ line.name }}</td>
              <td class="text-right">
                {{ displayPrice(line.price) }}
              </td>
              <td class="text-right">
                <select
                  :value="getLineDiscountAmount(line.productId)"
                  @change="setLineDiscountAmount(line.productId, Number(($event.target as HTMLSelectElement).value))"
                  class="select-input"
                  style="width: 120px;"
                >
                  <option :value="0">Không giảm</option>
                  <option
                    v-for="v in discountAmountOptions"
                    :key="v"
                    :value="v"
                  >
                    Giảm {{ displayPrice(v) }} đ
                  </option>
                </select>
              </td>
              <td class="text-right">
                <select
                  :value="getLineDiscountPercent(line.productId)"
                  @change="setLineDiscountPercent(line.productId, Number(($event.target as HTMLSelectElement).value))"
                  class="select-input"
                  style="width: 120px;"
                >
                  <option :value="0">Không giảm</option>
                  <option
                    v-for="v in discountPercentOptions"
                    :key="v"
                    :value="v"
                  >
                    Giảm {{ v }}%
                  </option>
                </select>
              </td>
              <td class="text-right">
                {{
                  noPayment
                    ? '0'
                    : displayPrice(discountedUnitPrice(line.price, line.productId))
                }}
              </td>
              <td class="text-right">
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    @click="updateCartQty(line.productId, -1)"
                  >
                    -
                  </button>
                  <span style="min-width: 26px; display: inline-block; text-align: center;">
                    {{ line.qty }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="isPlusDisabled(line)"
                    :class="{ 'btn-disabled-muted': isPlusDisabled(line) }"
                    @click="!isPlusDisabled(line) && updateCartQty(line.productId, 1)"
                  >
                    +
                  </button>
                </div>
              </td>
              <td class="text-right">
                {{
                  noPayment
                    ? displayPrice(0)
                    : displayPrice(discountedUnitPrice(line.price, line.productId) * line.qty)
                }}
              </td>
            </tr>
            <tr v-if="!cartLines.length">
              <td colspan="5" class="text-muted">
                Chưa có sản phẩm trong đơn hàng.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="checkout-summary">
        <div>
          <div class="checkout-total-label">Tổng tiền hàng</div>
          <div>
            <template v-if="hasCartDiscount">
              <span>
                {{ `${displayPrice(cartTotal)} đ - ${displayPrice(cartTotalDiscount)} đ = ` }}
              </span>
              <span class="checkout-total-value">
                {{ `${displayPrice(cartTotalAfterDiscount)} đ` }}
              </span>
            </template>
            <span v-else class="checkout-total-value">
              {{ `${displayPrice(cartTotalAfterDiscount)} đ` }}
            </span>
          </div>
        </div>
        <div class="checkout-actions">
          <label class="slide-checkbox">
            <input v-model="noPayment" type="checkbox" />
            <span class="slide-checkbox-slider" />
            <span class="slide-checkbox-label">Không thanh toán</span>
          </label>
          <button
            type="button"
            class="btn btn-primary"
            :class="{ disabled: !cartLines.length }"
            :disabled="!cartLines.length"
            @click="checkout"
          >
            Thanh toán
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.product-item-wrap.product-item-disabled {
  opacity: 0.55;
}
.product-item-wrap.product-item-disabled .product-item-button {
  cursor: not-allowed;
}
.btn-disabled-muted {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

