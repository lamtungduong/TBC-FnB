<script setup lang="ts">
import { computed } from 'vue'
import type { Sale, Product } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

type PaymentFilter = 'all' | 'paid' | 'unpaid'

const paymentFilter = ref<PaymentFilter>('paid')

/** Card được chọn: label hoặc null. Mặc định khi load = 30 ngày qua */
const selectedCardKey = ref<string | null>('30 ngày qua')

/** Sắp xếp bảng theo thời gian. Mặc định: Thời gian (newest > oldest) */
type TimeSortKey = 'label' | 'qty' | 'revenue' | 'profit'
const timeSortBy = ref<TimeSortKey | null>('label')
const timeSortDesc = ref(true)

/** Sắp xếp bảng theo sản phẩm. Mặc định: Lợi nhuận gộp (highest > lowest) */
type ProductSortKey = 'name' | 'qty' | 'revenue' | 'profit'
const productSortBy = ref<ProductSortKey | null>('profit')
const productSortDesc = ref(true)

const totalProductQty = computed(() =>
  productBuckets.value.reduce((sum, row) => sum + row.qty, 0)
)
const totalProductRevenue = computed(() =>
  productBuckets.value.reduce((sum, row) => sum + row.revenue, 0)
)
const totalProductProfit = computed(() =>
  productBuckets.value.reduce((sum, row) => sum + row.profit, 0)
)

const totalTimeQty = computed(() =>
  timeBuckets.value.reduce((sum, row) => sum + row.qty, 0)
)
const totalTimeRevenue = computed(() =>
  timeBuckets.value.reduce((sum, row) => sum + row.revenue, 0)
)
const totalTimeProfit = computed(() =>
  timeBuckets.value.reduce((sum, row) => sum + row.profit, 0)
)

const { sales, products } = usePosStore()

const filteredSales = computed(() => {
  const list = sales.value
  if (paymentFilter.value === 'all') return list
  return list.filter((s) => {
    const { revenue } = calcRevenueAndProfit(s)
    if (paymentFilter.value === 'paid') return revenue > 0
    return revenue === 0
  })
})

const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))
function productImageUrl(p: Product) {
  if (!p.image) return ''
  if (p.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(p.id)] ?? 0
    return `/api/blob-image?url=${encodeURIComponent(p.image)}&_t=${t}`
  }
  return p.image.startsWith('http') ? p.image : `/images/${p.image}`
}

function displayMoney(v: number) {
  return v.toLocaleString('vi-VN')
}

function getStartOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function getStartOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function getStartOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1)
}

function calcRevenueAndProfit(sale: Sale) {
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

/** Cấu hình 12 card: filter theo ngày + chế độ bảng thời gian (day = theo ngày 30 ngày, month = theo tháng tất cả) */
const cardConfigs = computed(() => {
  const now = new Date()
  const todayStart = getStartOfDay(now)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(todayStart.getDate() - 1)
  const yesterdayEnd = new Date(todayStart)
  yesterdayEnd.setMilliseconds(-1)

  const weekStart = new Date(todayStart)
  weekStart.setDate(todayStart.getDate() - todayStart.getDay())
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(weekStart.getDate() - 7)
  const lastWeekEnd = new Date(weekStart)
  lastWeekEnd.setMilliseconds(-1)

  const last7Start = new Date(todayStart)
  last7Start.setDate(todayStart.getDate() - 6)

  const monthStart = getStartOfMonth(now)
  const prevMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)
  const prevMonthEnd = new Date(monthStart)
  prevMonthEnd.setMilliseconds(-1)

  const last30Start = new Date(now)
  last30Start.setDate(now.getDate() - 29)
  last30Start.setHours(0, 0, 0, 0)

  const yearStart = getStartOfYear(now)
  const prevYearStart = new Date(yearStart.getFullYear() - 1, 0, 1)
  const prevYearEnd = new Date(yearStart)
  prevYearEnd.setMilliseconds(-1)

  const quarter = Math.floor(now.getMonth() / 3) + 1
  const quarterStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1)
  const prevQuarterStart = new Date(now.getFullYear(), (quarter - 2) * 3, 1)
  const prevQuarterEnd = new Date(quarterStart)
  prevQuarterEnd.setMilliseconds(-1)

  type CardConfig = { label: string; timeMode: 'day' | 'month'; filter: (d: Date) => boolean }
  const rows: CardConfig[][] = [
    [
      { label: 'Hôm nay', timeMode: 'day', filter: (d) => d >= todayStart },
      { label: 'Hôm qua', timeMode: 'day', filter: (d) => d >= yesterdayStart && d <= yesterdayEnd },
      { label: 'Tuần này', timeMode: 'day', filter: (d) => d >= weekStart },
      { label: 'Tuần trước', timeMode: 'day', filter: (d) => d >= lastWeekStart && d <= lastWeekEnd },
      { label: '7 ngày qua', timeMode: 'day', filter: (d) => d >= last7Start }
    ],
    [
      { label: 'Tháng này', timeMode: 'day', filter: (d) => d >= monthStart },
      { label: 'Tháng trước', timeMode: 'day', filter: (d) => d >= prevMonthStart && d <= prevMonthEnd },
      { label: '30 ngày qua', timeMode: 'day', filter: (d) => d >= last30Start }
    ],
    [
      { label: 'Quý này', timeMode: 'month', filter: (d) => d >= quarterStart },
      { label: 'Quý trước', timeMode: 'month', filter: (d) => d >= prevQuarterStart && d <= prevQuarterEnd },
      { label: 'Năm nay', timeMode: 'month', filter: (d) => d >= yearStart },
      { label: 'Năm trước', timeMode: 'month', filter: (d) => d >= prevYearStart && d <= prevYearEnd }
    ]
  ]
  const flat = rows.flat()
  return { rows, flat }
})

const selectedCardConfig = computed(() => {
  if (!selectedCardKey.value) return null
  return cardConfigs.value.flat.find((c) => c.label === selectedCardKey.value) ?? null
})

const timeBuckets = computed(() => {
  const now = new Date()
  const allSales = filteredSales.value.map((s) => ({
    ...s,
    date: new Date(s.timestamp)
  }))
  const byDay = !selectedCardConfig.value || selectedCardConfig.value.timeMode === 'day'

  const map = new Map<string, { label: string; qty: number; revenue: number; profit: number }>()

  if (byDay) {
    function bucketKeyDay(d: Date) {
      const k = getStartOfDay(d)
      return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`
    }
    function bucketLabelDay(key: string) {
      const [year, month, day] = key.split('-')
      return `${day}/${month}/${year}`
    }
    const last30Start = new Date(now)
    last30Start.setDate(now.getDate() - 29)
    last30Start.setHours(0, 0, 0, 0)
    const last30End = new Date(now)
    last30End.setHours(23, 59, 59, 999)
    const inLast30Days = (d: Date) => d >= last30Start && d <= last30End

    const salesToBucket = selectedCardConfig.value
      ? allSales
      : allSales.filter((s) => inLast30Days(s.date))

    for (const s of salesToBucket) {
      const key = bucketKeyDay(s.date)
      const { revenue, profit } = calcRevenueAndProfit(s)
      const qty = s.items.reduce((sum, item) => sum + item.qty, 0)
      if (!map.has(key)) {
        map.set(key, { label: bucketLabelDay(key), qty: 0, revenue: 0, profit: 0 })
      }
      const agg = map.get(key)!
      agg.qty += qty
      agg.revenue += revenue
      agg.profit += profit
    }

    if (selectedCardConfig.value) {
      const allKeys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1))
      const limitedKeys = allKeys.slice(0, 30)
      return limitedKeys.map((key) => ({
        key,
        label: map.get(key)!.label,
        qty: map.get(key)!.qty,
        revenue: map.get(key)!.revenue,
        profit: map.get(key)!.profit
      }))
    }

    const limitedKeys: string[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date(last30Start)
      d.setDate(last30Start.getDate() + i)
      limitedKeys.push(bucketKeyDay(d))
    }
    limitedKeys.reverse()
    return limitedKeys
      .map((key) => {
        const row = map.get(key)
        return {
          key,
          label: bucketLabelDay(key),
          qty: row?.qty ?? 0,
          revenue: row?.revenue ?? 0,
          profit: row?.profit ?? 0
        }
      })
      .filter((row) => row.qty > 0)
  }

  function bucketKeyMonth(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  function bucketLabelMonth(key: string) {
    const [year, month] = key.split('-')
    return `${month}/${year}`
  }
  for (const s of allSales) {
    const key = bucketKeyMonth(s.date)
    const { revenue, profit } = calcRevenueAndProfit(s)
    const qty = s.items.reduce((sum, item) => sum + item.qty, 0)
    if (!map.has(key)) {
      map.set(key, { label: bucketLabelMonth(key), qty: 0, revenue: 0, profit: 0 })
    }
    const agg = map.get(key)!
    agg.qty += qty
    agg.revenue += revenue
    agg.profit += profit
  }
  const allKeys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1))
  return allKeys.map((key) => ({
    key,
    label: map.get(key)!.label,
    qty: map.get(key)!.qty,
    revenue: map.get(key)!.revenue,
    profit: map.get(key)!.profit
  }))
})

const productBuckets = computed(() => {
  const now = new Date()
  const allSales = filteredSales.value.map((s) => ({
    ...s,
    date: new Date(s.timestamp)
  }))

  const dateFilter =
    selectedCardConfig.value?.filter ??
    (() => {
      const start = new Date(now)
      start.setDate(now.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      const end = new Date(now)
      end.setHours(23, 59, 59, 999)
      return (d: Date) => d >= start && d <= end
    })()

  const map = new Map<
    number,
    { product: Product; qty: number; revenue: number; profit: number }
  >()

  for (const s of allSales) {
    if (!dateFilter(s.date)) continue
    for (const item of s.items) {
      const product = products.value.find((p) => p.id === item.productId)
      if (!product) continue
      const lineRevenue = item.price * item.qty
      const lineCost = item.cost * item.qty
      if (!map.has(item.productId)) {
        map.set(item.productId, {
          product,
          qty: 0,
          revenue: 0,
          profit: 0
        })
      }
      const agg = map.get(item.productId)!
      agg.qty += item.qty
      agg.revenue += lineRevenue
      agg.profit += lineRevenue - lineCost
    }
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
})

/** Bảng theo thời gian đã sắp xếp theo cột được chọn */
const sortedTimeBuckets = computed(() => {
  const list = timeBuckets.value
  const by = timeSortBy.value
  const desc = timeSortDesc.value
  if (!by) return list
  return [...list].sort((a, b) => {
    let cmp = 0
    if (by === 'label') cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    else if (by === 'qty') cmp = a.qty - b.qty
    else if (by === 'revenue') cmp = a.revenue - b.revenue
    else cmp = a.profit - b.profit
    return desc ? -cmp : cmp
  })
})

/** Bảng theo sản phẩm đã sắp xếp theo cột được chọn */
const sortedProductBuckets = computed(() => {
  const list = productBuckets.value
  const by = productSortBy.value
  const desc = productSortDesc.value
  if (!by) return list
  return [...list].sort((a, b) => {
    let cmp = 0
    if (by === 'name') {
      const orderA = a.product.displayOrder ?? a.product.id
      const orderB = b.product.displayOrder ?? b.product.id
      cmp = orderA - orderB || a.product.id - b.product.id
    } else if (by === 'qty') cmp = a.qty - b.qty
    else if (by === 'revenue') cmp = a.revenue - b.revenue
    else cmp = a.profit - b.profit
    return desc ? -cmp : cmp
  })
})

function toggleTimeSort(key: TimeSortKey) {
  if (timeSortBy.value === key) {
    timeSortDesc.value = !timeSortDesc.value
  } else {
    timeSortBy.value = key
    timeSortDesc.value = true
  }
}

function toggleProductSort(key: ProductSortKey) {
  if (productSortBy.value === key) {
    productSortDesc.value = !productSortDesc.value
  } else {
    productSortBy.value = key
    productSortDesc.value = true
  }
}

function sumFor(filter: (d: Date) => boolean) {
  let revenue = 0
  let profit = 0
  for (const s of filteredSales.value) {
    const d = new Date(s.timestamp)
    if (!filter(d)) continue
    const r = calcRevenueAndProfit(s)
    revenue += r.revenue
    profit += r.profit
  }
  return { revenue, profit }
}

const summaryCardRows = computed(() =>
  cardConfigs.value.rows.map((row) =>
    row.map((c) => ({ label: c.label, ...sumFor(c.filter) }))
  )
)
</script>

<template>
  <section class="card">
    <div class="report-toolbar" style="margin-bottom: 8px;">
      <span style="font-size: 13px;">Loại đơn:</span>
      <div class="report-toggle-group">
        <button
          type="button"
          class="report-toggle-btn"
          :class="{ active: paymentFilter === 'all' }"
          @click="paymentFilter = 'all'"
        >
          Tất cả
        </button>
        <button
          type="button"
          class="report-toggle-btn"
          :class="{ active: paymentFilter === 'paid' }"
          @click="paymentFilter = 'paid'"
        >
          Đơn thanh toán
        </button>
        <button
          type="button"
          class="report-toggle-btn"
          :class="{ active: paymentFilter === 'unpaid' }"
          @click="paymentFilter = 'unpaid'"
        >
          Đơn không thanh toán
        </button>
      </div>
    </div>

    <div class="report-summary-rows" style="margin-bottom: 8px;">
      <div v-for="(row, rowIndex) in summaryCardRows" :key="rowIndex" class="report-summary report-summary-inline">
        <div
          v-for="card in row"
          :key="card.label"
          class="summary-card summary-card-inline"
          :class="{ 'summary-card-selected': selectedCardKey === card.label }"
          role="button"
          tabindex="0"
          @click="selectedCardKey = selectedCardKey === card.label ? null : card.label"
          @keydown.enter.space.prevent="selectedCardKey = selectedCardKey === card.label ? null : card.label"
        >
          <span class="summary-label">{{ card.label }}</span>
          <span class="summary-value summary-value-cell">{{ displayMoney(card.revenue) }} đ</span>
          <span class="summary-sub summary-sub-label">Lợi nhuận gộp:</span>
          <span class="summary-sub summary-sub-cell">{{ displayMoney(card.profit) }} đ</span>
        </div>
      </div>
    </div>

    <div
      class="report-tables"
      style="display: flex; gap: 8px; max-height: calc(100vh - 260px);"
    >
      <div style="flex: 1; overflow: auto; max-height: 615px;">
        <table class="table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: timeSortBy === 'label' }"
                  @click="toggleTimeSort('label')"
                >
                  Thời gian
                  <span v-if="timeSortBy === 'label'" class="report-th-sort-icon">{{ timeSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: timeSortBy === 'qty' }"
                  @click="toggleTimeSort('qty')"
                >
                  Số lượng bán
                  <span v-if="timeSortBy === 'qty'" class="report-th-sort-icon">{{ timeSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: timeSortBy === 'revenue' }"
                  @click="toggleTimeSort('revenue')"
                >
                  Doanh thu
                  <span v-if="timeSortBy === 'revenue'" class="report-th-sort-icon">{{ timeSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: timeSortBy === 'profit' }"
                  @click="toggleTimeSort('profit')"
                >
                  Lợi nhuận gộp
                  <span v-if="timeSortBy === 'profit'" class="report-th-sort-icon">{{ timeSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
            </tr>
            <tr>
              <th></th>
              <th class="text-right" style="font-weight: bold;">
                {{ totalTimeQty.toLocaleString('vi-VN') }}
              </th>
              <th class="text-right" style="font-weight: bold;">
                {{ displayMoney(totalTimeRevenue) }}
              </th>
              <th class="text-right" style="font-weight: bold;">
                {{ displayMoney(totalTimeProfit) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sortedTimeBuckets" :key="row.key">
              <td>{{ row.label }}</td>
              <td class="text-right">
                {{ row.qty.toLocaleString('vi-VN') }}
              </td>
              <td class="text-right">
                {{ displayMoney(row.revenue) }}
              </td>
              <td class="text-right">
                {{ displayMoney(row.profit) }}
              </td>
            </tr>
            <tr v-if="!sortedTimeBuckets.length">
              <td colspan="4" class="text-muted">
                Chưa có dữ liệu bán hàng.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="flex: 1; overflow: auto; max-height: 615px;">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 70px;">Hình</th>
              <th>
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: productSortBy === 'name' }"
                  @click="toggleProductSort('name')"
                >
                  Sản phẩm
                  <span v-if="productSortBy === 'name'" class="report-th-sort-icon">{{ productSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: productSortBy === 'qty' }"
                  @click="toggleProductSort('qty')"
                >
                  Số lượng bán
                  <span v-if="productSortBy === 'qty'" class="report-th-sort-icon">{{ productSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: productSortBy === 'revenue' }"
                  @click="toggleProductSort('revenue')"
                >
                  Doanh thu
                  <span v-if="productSortBy === 'revenue'" class="report-th-sort-icon">{{ productSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
              <th class="text-right">
                <button
                  type="button"
                  class="report-th-sort"
                  :class="{ active: productSortBy === 'profit' }"
                  @click="toggleProductSort('profit')"
                >
                  Lợi nhuận gộp
                  <span v-if="productSortBy === 'profit'" class="report-th-sort-icon">{{ productSortDesc ? '▼' : '▲' }}</span>
                </button>
              </th>
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th class="text-right" style="font-weight: bold;">
                {{ totalProductQty.toLocaleString('vi-VN') }}
              </th>
              <th class="text-right" style="font-weight: bold;">
                {{ displayMoney(totalProductRevenue) }}
              </th>
              <th class="text-right" style="font-weight: bold;">
                {{ displayMoney(totalProductProfit) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sortedProductBuckets" :key="row.product.id">
              <td>
                <div class="product-thumb">
                  <img
                    v-if="row.product.image"
                    :src="productImageUrl(row.product)"
                    :alt="row.product.name"
                  />
                  <span v-else>Không có ảnh</span>
                </div>
              </td>
              <td>{{ row.product.name || `Mã ${row.product.id}` }}</td>
              <td class="text-right">
                {{ row.qty.toLocaleString('vi-VN') }}
              </td>
              <td class="text-right">
                {{ displayMoney(row.revenue) }}
              </td>
              <td class="text-right">
                {{ displayMoney(row.profit) }}
              </td>
            </tr>
            <tr v-if="!sortedProductBuckets.length">
              <td colspan="5" class="text-muted">
                Chưa có dữ liệu bán hàng.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>


