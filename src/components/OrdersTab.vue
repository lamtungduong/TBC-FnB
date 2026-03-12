<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Sale, SaleItem } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

const { sales, products, namedProducts, deleteSale, updateSale } = usePosStore()

const pageSize = 100
const currentPage = ref(1)

const sortedSales = computed(() =>
  [...sales.value].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
)

const pageCount = computed(() =>
  Math.max(1, Math.ceil(sortedSales.value.length / pageSize))
)

const paginatedSales = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return sortedSales.value.slice(start, start + pageSize)
})

watch(
  () => sales.value.length,
  () => {
    if (currentPage.value > pageCount.value) {
      currentPage.value = pageCount.value
    }
  }
)

function displayMoney(v: number) {
  return v.toLocaleString('vi-VN')
}

function formatTime(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function calcTotals(sale: Sale) {
  let revenue = 0
  let profit = 0
  for (const item of sale.items) {
    const lineRevenue = item.price * item.qty
    const lineCost = item.cost * item.qty
    revenue += lineRevenue
    profit += lineRevenue - lineCost
  }
  return { revenue, profit }
}

function formatItems(sale: Sale) {
  if (!sale.items?.length) return ''
  return sale.items
    .map((item) => {
      const product =
        namedProducts.value.find((p) => p.id === item.productId) ||
        products.value.find((p) => p.id === item.productId)
      const name = product?.name || `Mã ${item.productId}`
      return `${name} * ${item.qty}`
    })
    .join(', ')
}

async function handleDelete(id: number) {
  const ok = window.confirm('Bạn có chắc chắn muốn xóa đơn hàng này?')
  if (!ok) return
  await deleteSale(id)
}

type EditingLine = {
  productId: number
  name: string
  price: number
  cost: number
  qty: number
}

const editingSaleId = ref<number | null>(null)
const editingLines = ref<EditingLine[]>([])
const isSavingEdit = ref(false)

const editingTotal = computed(() =>
  editingLines.value.reduce(
    (sum, line) => sum + line.price * line.qty,
    0
  )
)

function startEdit(sale: Sale) {
  editingSaleId.value = sale.id
  const itemByProductId = new Map<number, SaleItem>(
    sale.items.map((item) => [item.productId, item])
  )
  editingLines.value = products.value.map((product) => {
    const item: SaleItem | undefined = itemByProductId.get(product.id)
    return {
      productId: product.id,
      name: product.name || `Mã ${product.id}`,
      price: item ? item.price : product.price,
      cost: item ? item.cost : product.cost,
      qty: item ? item.qty : 0
    }
  })

  if (import.meta.client && window.innerWidth < 768) {
    nextTick(() => {
      const el = document.getElementById('order-edit-card')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

function updateEditingQty(productId: number, delta: number) {
  const line = editingLines.value.find((l) => l.productId === productId)
  if (!line) return
  line.qty = Math.max(0, line.qty + delta)
}

async function handleSaveEdit() {
  if (!editingSaleId.value) return
  if (isSavingEdit.value) return
  const itemsToSave = editingLines.value.filter((line) => line.qty > 0)
  isSavingEdit.value = true
  try {
    await updateSale(
      editingSaleId.value,
      itemsToSave.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        price: line.price,
        cost: line.cost
      }))
    )
    editingSaleId.value = null
    editingLines.value = []
  } finally {
    isSavingEdit.value = false
  }
}
</script>

<template>
  <div class="split-layout">
    <section class="card">
      <div
        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
      >
        <h3 style="margin: 0; font-size: 14px;">Đơn hàng</h3>
        <div
          v-if="sortedSales.length"
          style="font-size: 12px; display: flex; gap: 8px; align-items: center;"
        >
          <span>Trang {{ currentPage }} / {{ pageCount }}</span>
          <div style="display: inline-flex; gap: 4px;">
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="currentPage <= 1"
              @click="currentPage = Math.max(1, currentPage - 1)"
            >
              Trước
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              :disabled="currentPage >= pageCount"
              @click="currentPage = Math.min(pageCount, currentPage + 1)"
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      <div style="max-height: calc(100vh - 155px); overflow: auto;">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 90px;">Thời gian</th>
              <th>Hàng hóa</th>
              <th class="text-right">Doanh thu</th>
              <th class="text-right">Lợi nhuận gộp</th>
              <th style="width: 110px;" class="text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sale in paginatedSales" :key="sale.id">
              <td>{{ sale.id }}</td>
              <td>{{ formatTime(sale.timestamp) }}</td>
              <td>{{ formatItems(sale) }}</td>
              <td class="text-right">
                {{
                  displayMoney(
                    calcTotals(sale).revenue
                  )
                }}
              </td>
              <td class="text-right">
                {{
                  displayMoney(
                    calcTotals(sale).profit
                  )
                }}
              </td>
              <td class="text-center">
                <button
                  type="button"
                  class="btn btn-default btn-xs"
                  style="margin-right: 4px;"
                  @click="startEdit(sale)"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  class="btn btn-default btn-xs"
                  @click="handleDelete(sale.id)"
                >
                  Xóa
                </button>
              </td>
            </tr>
            <tr v-if="!paginatedSales.length">
              <td colspan="6" class="text-muted">
                Chưa có đơn hàng nào.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" id="order-edit-card">
      <h3 style="margin: 0 0 8px; font-size: 14px;">Chỉnh sửa đơn hàng</h3>
      <div v-if="editingSaleId === null" class="text-muted" style="font-size: 13px;">
        Chọn một đơn hàng ở bảng bên cạnh để chỉnh sửa.
      </div>
      <div
        v-else
        style="max-height: calc(100vh - 220px); overflow: auto;"
      >
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
            <tr v-for="(line, idx) in editingLines" :key="line.productId">
              <td>{{ idx + 1 }}</td>
              <td>{{ line.name }}</td>
              <td class="text-right">
                {{ displayMoney(line.price) }}
              </td>
              <td class="text-right">
                <div style="display: inline-flex; align-items: center; gap: 4px;">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    :disabled="line.qty <= 0"
                    @click="updateEditingQty(line.productId, -1)"
                  >
                    -
                  </button>
                  <span style="min-width: 26px; display: inline-block; text-align: center;">
                    {{ line.qty }}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    @click="updateEditingQty(line.productId, 1)"
                  >
                    +
                  </button>
                </div>
              </td>
              <td class="text-right">
                {{ displayMoney(line.price * line.qty) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="editingSaleId !== null"
        class="checkout-summary"
        style="margin-top: 8px;"
      >
        <div>
          <div class="checkout-total-label">Tổng tiền hàng</div>
          <div class="checkout-total-value">
            {{ displayMoney(editingTotal) }} đ
          </div>
        </div>
        <div class="checkout-actions">
          <button
            type="button"
            class="btn btn-primary"
            :class="{ disabled: isSavingEdit }"
            :disabled="isSavingEdit"
            @click="handleSaveEdit"
          >
            Sửa đơn
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

