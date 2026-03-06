<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Product, StockImport } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

const { products, importStock, imports, deleteImport } = usePosStore()

type PurchaseRow = {
  cases: number
  pricePerCase: number
  packSize: number
}

const rows = reactive<Record<number, PurchaseRow>>({})
const saving = ref(false)
const deletingId = ref<number | null>(null)
const expandedImport = ref(true)
const expandedHistory = ref(true)

function getLastImportPrice(productId: number): number {
  for (let i = imports.value.length - 1; i >= 0; i--) {
    const entry = imports.value[i]
    const found = entry.items.find((item) => item.productId === productId)
    if (found) {
      return found.pricePerCase
    }
  }
  return 0
}

const productsWithRows = computed(() =>
  products.value
    .filter((p) => !p.isHidden)
    .map((p) => {
      if (!rows[p.id]) {
        rows[p.id] = {
          cases: 0,
          pricePerCase: getLastImportPrice(p.id),
          packSize: p.packSize ?? 24
        }
      }
      return {
        product: p,
        row: rows[p.id]
      }
    })
)

function updateCases(row: PurchaseRow, delta: number) {
  const next = (row.cases || 0) + delta
  row.cases = next < 0 ? 0 : next
}

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

function formatImportTimestamp(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}

function importOrderSummary(entry: StockImport) {
  const parts = entry.items.map((item) => {
    const product = products.value.find((p) => p.id === item.productId)
    const name = product?.name || `Mã ${item.productId}`
    return `${name} * ${item.cases} (thùng)`
  })
  return parts.join(', ')
}

function importTotalFormula(entry: StockImport) {
  const terms: string[] = []
  let total = 0
  for (const item of entry.items) {
    terms.push(
      `${displayMoney(item.pricePerCase)} * ${item.cases}`
    )
    total += item.addedCost
  }
  const left = terms.join(' + ')
  return `${left} = ${displayMoney(total)}`
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

async function handleDeleteImport(id: number) {
  const confirmed = window.confirm(
    `Bạn có chắc muốn xóa đơn nhập hàng #${id}? Hành động này không thể hoàn tác.`
  )
  if (!confirmed) return
  try {
    deletingId.value = id
    await deleteImport(id)
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <section :class="['card', { 'card-disabled': saving }]">
    <div
      class="card-header-toggle"
      role="button"
      tabindex="0"
      @click="expandedImport = !expandedImport"
      @keydown.enter.prevent="expandedImport = !expandedImport"
    >
      <h3 style="margin: 0; font-size: 14px;">Nhập hàng</h3>
      <span class="card-toggle-icon" :class="{ collapsed: !expandedImport }">▼</span>
    </div>

    <div v-show="expandedImport" class="products-table-wrapper">
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
              <div style="display: inline-flex; align-items: center; gap: 4px;">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  @click="updateCases(item.row, -1)"
                >
                  -
                </button>
                <span style="min-width: 26px; display: inline-block; text-align: center;">
                  {{ item.row.cases }}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  @click="updateCases(item.row, 1)"
                >
                  +
                </button>
              </div>
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
      v-show="expandedImport"
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

  <section :class="['card', { 'card-disabled': saving }]" style="margin-top: 16px;">
    <div
      class="card-header-toggle"
      role="button"
      tabindex="0"
      @click="expandedHistory = !expandedHistory"
      @keydown.enter.prevent="expandedHistory = !expandedHistory"
    >
      <h3 style="margin: 0; font-size: 14px;">Lịch sử nhập hàng</h3>
      <span class="card-toggle-icon" :class="{ collapsed: !expandedHistory }">▼</span>
    </div>

    <div v-show="expandedHistory" class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 60px;">ID</th>
            <th style="width: 180px;">Thời gian</th>
            <th>Đơn hàng nhập</th>
            <th style="width: 260px;">Tổng tiền hàng</th>
            <th style="width: 90px;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in imports" :key="entry.id">
            <td>{{ entry.id }}</td>
            <td>{{ formatImportTimestamp(entry.timestamp) }}</td>
            <td style="font-size: 13px;">
              {{ importOrderSummary(entry) }}
            </td>
            <td style="font-size: 13px;">
              {{ importTotalFormula(entry) }}
            </td>
            <td>
              <button
                type="button"
                class="btn btn-danger btn-sm"
                :class="{ disabled: deletingId === entry.id }"
                :disabled="deletingId === entry.id"
                @click="handleDeleteImport(entry.id)"
              >
                {{ deletingId === entry.id ? 'Đang xóa...' : 'Xóa' }}
              </button>
            </td>
          </tr>
          <tr v-if="!imports.length">
            <td colspan="5" class="text-muted" style="font-size: 13px;">
              Chưa có lịch sử nhập hàng trong phiên hiện tại.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.card-header-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}
.card-header-toggle:focus {
  outline: none;
}
.card-toggle-icon {
  font-size: 10px;
  opacity: 0.7;
  transition: transform 0.2s ease;
}
.card-toggle-icon.collapsed {
  transform: rotate(-90deg);
}
</style>

