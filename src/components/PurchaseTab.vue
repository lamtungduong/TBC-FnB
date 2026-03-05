<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Product } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

const { products, importStock } = usePosStore()

type PurchaseRow = {
  cases: number
  pricePerCase: number
  packSize: number
}

const rows = reactive<Record<number, PurchaseRow>>({})
const saving = ref(false)

const productsWithRows = computed(() =>
  products.value
    .filter((p) => !p.isHidden)
    .map((p) => {
      if (!rows[p.id]) {
        rows[p.id] = {
          cases: 0,
          pricePerCase: 0,
          packSize: p.packSize ?? 24
        }
      }
      return {
        product: p,
        row: rows[p.id]
      }
    })
)

function productImageUrl(product: Product) {
  if (!product.image) return ''
  return `/images/${product.image}`
}

const totalAmount = computed(() =>
  productsWithRows.value.reduce(
    (sum, item) => sum + item.row.cases * item.row.pricePerCase,
    0
  )
)

function displayMoney(v: number) {
  return v.toLocaleString('vi-VN')
}

function formatMoneyInput(v: number) {
  if (!v) return ''
  return v.toLocaleString('vi-VN')
}

async function handleImport() {
  const payload = productsWithRows.value
    .filter((item) => item.row.cases > 0 && item.row.pricePerCase > 0)
    .map((item) => ({
      productId: item.product.id,
      cases: item.row.cases,
      pricePerCase: item.row.pricePerCase,
      packSize: item.row.packSize || item.product.packSize || 24
    }))

  if (!payload.length) return

  try {
    saving.value = true
    await importStock(payload)

    for (const item of productsWithRows.value) {
      item.row.cases = 0
      item.row.pricePerCase = 0
      item.row.packSize = item.product.packSize ?? 24
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="card">
    <div style="margin-bottom: 8px;">
      <h3 style="margin: 0; font-size: 14px;">Nhập hàng</h3>
    </div>

    <div class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th>Tên hàng</th>
            <th style="width: 100px;">Hình ảnh</th>
            <th style="width: 110px;" class="text-right">SL nhập (thùng)</th>
            <th style="width: 130px;" class="text-right">Giá nhập/thùng</th>
            <th style="width: 90px;" class="text-right">SL/thùng</th>
            <th style="width: 130px;" class="text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in productsWithRows" :key="item.product.id">
            <td>{{ idx + 1 }}</td>
            <td>{{ item.product.name || `Mã ${item.product.id}` }}</td>
            <td>
              <div class="product-thumb">
                <img
                  v-if="item.product.image"
                  :src="productImageUrl(item.product)"
                  :alt="item.product.name"
                />
                <span v-else>Không có ảnh</span>
              </div>
            </td>
            <td class="text-right">
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                v-model.number="item.row.cases"
              />
            </td>
            <td class="text-right">
              <input
                class="number-input"
                type="text"
                inputmode="numeric"
                :value="formatMoneyInput(item.row.pricePerCase)"
                @input="
                  item.row.pricePerCase = Number(
                    ($event.target as HTMLInputElement).value.replace(/[^0-9]/g, '') || '0'
                  )
                "
              />
            </td>
            <td class="text-right">
              <input
                class="number-input"
                type="number"
                step="1"
                min="1"
                v-model.number="item.row.packSize"
              />
            </td>
            <td class="text-right">
              {{ displayMoney(item.row.cases * item.row.pricePerCase) }}
            </td>
          </tr>
          <tr v-if="!productsWithRows.length">
            <td colspan="7" class="text-muted" style="font-size: 13px;">
              Chưa có sản phẩm. Vào tab <b>Sản phẩm</b> để khai báo.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      style="
        margin-top: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      "
    >
      <div>
        <div style="font-size: 13px; color: #6b7280;">Tổng tiền hàng</div>
        <div style="font-size: 18px; font-weight: 600;">
          {{ displayMoney(totalAmount) }} đ
        </div>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :class="{ disabled: !totalAmount || saving }"
        :disabled="!totalAmount || saving"
        @click="handleImport"
      >
        {{ saving ? 'Đang lưu...' : 'Nhập hàng' }}
      </button>
    </div>
  </section>
</template>

