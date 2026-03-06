<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Sale, Product } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

const { sales, products, namedProducts, deleteSale } = usePosStore()

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
</script>

<template>
  <section class="card">
    <div
      style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
    >
      <h3 style="margin: 0; font-size: 14px;">Đơn hàng</h3>
      <div v-if="sortedSales.length" style="font-size: 12px; display: flex; gap: 8px; align-items: center;">
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

    <div style="max-height: calc(100vh - 220px); overflow: auto;">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 60px;">ID</th>
            <th style="width: 180px;">Thời gian</th>
            <th>Hàng hóa</th>
            <th class="text-right">Doanh thu</th>
            <th class="text-right">Lợi nhuận gộp</th>
            <th style="width: 80px;">Thao tác</th>
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
</template>

