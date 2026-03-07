<script setup lang="ts">
import type { Product } from '~/composables/usePosStore'

const { namedProducts, cartLines, cartTotal, noPayment, addToCart, updateCartQty, checkout, reorderProducts } =
  usePosStore()
const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))

let dragProductId: number | null = null

function displayPrice(value: number) {
  return value.toLocaleString('vi-VN')
}

function productImageUrl(p: Product) {
  if (!p.image) return ''
  if (p.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(p.id)] ?? 0
    return `/api/blob-image?url=${encodeURIComponent(p.image)}&_t=${t}`
  }
  return p.image.startsWith('http') ? p.image : `/images/${p.image}`
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
          draggable="true"
          @dragstart="onDragStart($event, p.id)"
          @dragend="onDragEnd"
          @dragover="onDragOver"
          @drop="onDrop($event, index)"
        >
          <button
            class="product-item-button"
            type="button"
            @click="addToCart(p.id)"
          >
            <div class="product-thumb">
              <img v-if="p.image" :src="productImageUrl(p)" :alt="p.name" />
              <span v-else>Không có ảnh</span>
            </div>
            <div class="product-info">
              <div class="product-name">{{ p.name }}</div>
              <div class="product-info-row2">
                <span class="product-price">{{ displayPrice(p.price) }} đ</span>
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
          <div class="checkout-total-value">
            {{ displayPrice(cartTotal) }} đ
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

