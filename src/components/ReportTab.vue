<script setup lang="ts">
import { computed } from 'vue'
import type { Sale, Product } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

type TimeMode = 'day' | 'month' | 'year'
type ReportMode = 'time' | 'product'

const timeMode = ref<TimeMode>('day')
const reportMode = ref<ReportMode>('time')

const { sales, products } = usePosStore()

function productImageUrl(p: Product) {
  if (!p.image) return ''
  return `/images/${p.image}`
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

const timeBuckets = computed(() => {
  const now = new Date()
  const allSales = sales.value.map((s) => ({
    ...s,
    date: new Date(s.timestamp)
  }))

  const map = new Map<string, { label: string; revenue: number; profit: number }>()

  function bucketKey(d: Date) {
    if (timeMode.value === 'day') {
      const k = getStartOfDay(d)
      return k.toISOString().slice(0, 10)
    }
    if (timeMode.value === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    return String(d.getFullYear())
  }

  function bucketLabel(key: string) {
    if (timeMode.value === 'day') {
      const d = new Date(key)
      return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    }
    if (timeMode.value === 'month') {
      const [year, month] = key.split('-')
      return `${month}/${year}`
    }
    return key
  }

  for (const s of allSales) {
    const key = bucketKey(s.date)
    const { revenue, profit } = calcRevenueAndProfit(s)
    if (!map.has(key)) {
      map.set(key, { label: bucketLabel(key), revenue: 0, profit: 0 })
    }
    const agg = map.get(key)!
    agg.revenue += revenue
    agg.profit += profit
  }

  const allKeys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1))

  let limit = Infinity
  if (timeMode.value === 'day') limit = 30
  if (timeMode.value === 'month') limit = 12

  const limitedKeys = allKeys.slice(0, limit)

  return limitedKeys.map((key) => ({
    key,
    label: map.get(key)!.label,
    revenue: map.get(key)!.revenue,
    profit: map.get(key)!.profit
  }))
})

const productBuckets = computed(() => {
  const now = new Date()
  const allSales = sales.value.map((s) => ({
    ...s,
    date: new Date(s.timestamp)
  }))

  function inSelectedRange(date: Date) {
    if (timeMode.value === 'day') {
      const start = new Date(now)
      start.setDate(now.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      const end = new Date(now)
      end.setHours(23, 59, 59, 999)
      return date >= start && date <= end
    }
    if (timeMode.value === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      return date >= start && date <= end
    }
    const start = new Date(now.getFullYear() - 5, 0, 1)
    const end = new Date(now.getFullYear() + 1, 0, 1)
    return date >= start && date < end
  }

  const map = new Map<
    number,
    { product: Product; qty: number; revenue: number; profit: number }
  >()

  for (const s of allSales) {
    if (!inSelectedRange(s.date)) continue
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

const summaryCards = computed(() => {
  const now = new Date()

  function sumFor(filter: (d: Date) => boolean) {
    let revenue = 0
    let profit = 0
    for (const s of sales.value) {
      const d = new Date(s.timestamp)
      if (!filter(d)) continue
      const r = calcRevenueAndProfit(s)
      revenue += r.revenue
      profit += r.profit
    }
    return { revenue, profit }
  }

  if (timeMode.value === 'day') {
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

    return [
      {
        label: 'Hôm nay',
        ...sumFor((d) => d >= todayStart)
      },
      {
        label: 'Hôm qua',
        ...sumFor((d) => d >= yesterdayStart && d <= yesterdayEnd)
      },
      {
        label: 'Tuần này',
        ...sumFor((d) => d >= weekStart)
      },
      {
        label: 'Tuần trước',
        ...sumFor((d) => d >= lastWeekStart && d <= lastWeekEnd)
      },
      {
        label: '7 ngày qua',
        ...sumFor((d) => d >= last7Start)
      }
    ]
  }

  if (timeMode.value === 'month') {
    const monthStart = getStartOfMonth(now)
    const prevMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)
    const prevMonthEnd = new Date(monthStart)
    prevMonthEnd.setMilliseconds(-1)

    const last30Start = new Date(now)
    last30Start.setDate(now.getDate() - 29)
    last30Start.setHours(0, 0, 0, 0)

    return [
      {
        label: 'Tháng này',
        ...sumFor((d) => d >= monthStart)
      },
      {
        label: 'Tháng trước',
        ...sumFor((d) => d >= prevMonthStart && d <= prevMonthEnd)
      },
      {
        label: '30 ngày qua',
        ...sumFor((d) => d >= last30Start)
      }
    ]
  }

  const yearStart = getStartOfYear(now)
  const prevYearStart = new Date(yearStart.getFullYear() - 1, 0, 1)
  const prevYearEnd = new Date(yearStart)
  prevYearEnd.setMilliseconds(-1)

  const quarter = Math.floor(now.getMonth() / 3) + 1
  const quarterStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1)
  const prevQuarterStart = new Date(now.getFullYear(), (quarter - 2) * 3, 1)
  const prevQuarterEnd = new Date(quarterStart)
  prevQuarterEnd.setMilliseconds(-1)

  return [
    {
      label: 'Quý này',
      ...sumFor((d) => d >= quarterStart)
    },
    {
      label: 'Quý trước',
      ...sumFor((d) => d >= prevQuarterStart && d <= prevQuarterEnd)
    },
    {
      label: 'Năm nay',
      ...sumFor((d) => d >= yearStart)
    },
    {
      label: 'Năm trước',
      ...sumFor((d) => d >= prevYearStart && d <= prevYearEnd)
    }
  ]
})
</script>

<template>
  <section class="card">
    <div class="report-toolbar" style="margin-bottom: 8px;">
      <label style="font-size: 13px;">
        Thời gian:
        <select v-model="timeMode" class="select-input">
          <option value="day">Ngày</option>
          <option value="month">Tháng</option>
          <option value="year">Năm</option>
        </select>
      </label>

      <span style="font-size: 13px;">Báo cáo theo</span>

      <div class="report-toggle-group">
        <button
          type="button"
          class="report-toggle-btn"
          :class="{ active: reportMode === 'time', disabled: reportMode === 'time' }"
          :disabled="reportMode === 'time'"
          @click="reportMode = 'time'"
        >
          Thời gian
        </button>
        <button
          type="button"
          class="report-toggle-btn"
          :class="{ active: reportMode === 'product', disabled: reportMode === 'product' }"
          :disabled="reportMode === 'product'"
          @click="reportMode = 'product'"
        >
          Sản phẩm
        </button>
      </div>
    </div>

    <div class="report-summary" style="margin-bottom: 8px;">
      <div v-for="card in summaryCards" :key="card.label" class="summary-card">
        <div class="summary-label">{{ card.label }}</div>
        <div class="summary-value">
          {{ displayMoney(card.revenue) }} đ
        </div>
        <div class="summary-sub">
          Lợi nhuận gộp: {{ displayMoney(card.profit) }} đ
        </div>
      </div>
    </div>

    <div style="max-height: calc(100vh - 260px); overflow: auto;">
      <table class="table">
        <thead>
          <tr v-if="reportMode === 'time'">
            <th>Thời gian</th>
            <th class="text-right">Doanh thu</th>
            <th class="text-right">Lợi nhuận gộp</th>
          </tr>
          <tr v-else>
            <th style="width: 70px;">Hình</th>
            <th>Sản phẩm</th>
            <th class="text-right">Số lượng bán</th>
            <th class="text-right">Doanh thu</th>
            <th class="text-right">Lợi nhuận gộp</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="reportMode === 'time'" v-for="row in timeBuckets" :key="row.key">
            <td>{{ row.label }}</td>
            <td class="text-right">
              {{ displayMoney(row.revenue) }}
            </td>
            <td class="text-right">
              {{ displayMoney(row.profit) }}
            </td>
          </tr>

          <tr v-else v-for="row in productBuckets" :key="row.product.id">
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

          <tr v-if="!timeBuckets.length && reportMode === 'time'">
            <td colspan="3" class="text-muted">
              Chưa có dữ liệu bán hàng.
            </td>
          </tr>
          <tr v-if="!productBuckets.length && reportMode === 'product'">
            <td colspan="4" class="text-muted">
              Chưa có dữ liệu bán hàng.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

