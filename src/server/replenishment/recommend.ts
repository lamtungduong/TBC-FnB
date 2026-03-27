import { parseTimestampAsGMT7 } from '../../utils/date'
import type { PosData, Product, Sale, Vendor } from '../posData'

export type ReplenishmentProductSuggestion = {
  productId: number
  productName: string
  packSize: number
  currentStockUnits: number
  minStockCases: number
  maxStockCases: number
  minStockUnits: number
  maxStockUnits: number
  demandPerDayEma: number
  demandPerDayStd: number
  daysUntilZero: number | null
  needByDate: string | null // YYYY-MM-DD
  chosenVendorId: number | null
  chosenVendorName: string | null
  leadTimeDays: number | null
  chosenPricePerCase: number | null
  recommendedCases: number
  expectedArrivalDate: string | null // YYYY-MM-DD
  riskFlags: string[]
}

export type ReplenishmentVendorOrderLine = {
  productId: number
  productName: string
  packSize: number
  currentStockUnits: number
  minStockUnits: number
  cases: number
  pricePerCase: number
  lineCost: number
  expectedArrivalDate: string | null
  needByDate: string | null
  riskFlags: string[]
}

export type ReplenishmentVendorOrder = {
  vendorId: number
  vendorName: string
  vendorPhone: string | null
  leadTimeDays: number
  minOrderCases: number
  totalCases: number
  totalCost: number
  meetsMinOrder: boolean
  lines: ReplenishmentVendorOrderLine[]
}

export type ReplenishmentResult = {
  generatedAt: string
  horizonDays: number
  maxZeroDaysAllowed: number
  minVendorOrderCases: number
  products: ReplenishmentProductSuggestion[]
  vendorOrders: ReplenishmentVendorOrder[]
}

type VendorPriceRow = {
  product_id: number
  vendor_id: number
  price_per_case: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function formatDateYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDaysUTC(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

export function parseLeadTimeDaysFromVendorNote(
  vendor: Vendor,
  defaultDays = 3
): number {
  const note = (vendor.note || '').toLowerCase()
  if (!note.trim()) return defaultDays

  const matches = note.match(/(\d+)\s*-\s*(\d+)/)
  if (matches) {
    const a = Number(matches[1])
    const b = Number(matches[2])
    const hi = Math.max(a, b)
    return Number.isFinite(hi) && hi >= 0 ? hi : defaultDays
  }

  const single = note.match(/(\d+)/)
  if (single) {
    const v = Number(single[1])
    return Number.isFinite(v) && v >= 0 ? v : defaultDays
  }

  return defaultDays
}

function buildDailyDemandSeries(
  sales: Sale[],
  productId: number,
  historyDays: number,
  todayStartUtc: Date
): number[] {
  const start = addDaysUTC(todayStartUtc, -(historyDays - 1))
  const demandByKey = new Map<string, number>()

  for (const s of sales) {
    const d = parseTimestampAsGMT7(s.timestamp)
    const dayKey = formatDateYYYYMMDD(startOfDayUTC(d))
    if (dayKey < formatDateYYYYMMDD(start)) continue
    if (dayKey > formatDateYYYYMMDD(todayStartUtc)) continue
    let qty = 0
    for (const it of s.items) {
      if (it.productId === productId) qty += it.qty
    }
    if (qty <= 0) continue
    demandByKey.set(dayKey, (demandByKey.get(dayKey) ?? 0) + qty)
  }

  const series: number[] = []
  for (let i = 0; i < historyDays; i++) {
    const key = formatDateYYYYMMDD(addDaysUTC(start, i))
    series.push(demandByKey.get(key) ?? 0)
  }
  return series
}

function emaFromSeries(series: number[], alpha: number): number {
  if (!series.length) return 0
  let ema = series[0] ?? 0
  for (let i = 1; i < series.length; i++) {
    ema = alpha * (series[i] ?? 0) + (1 - alpha) * ema
  }
  return ema
}

function meanAndStd(series: number[]): { mean: number; std: number } {
  if (!series.length) return { mean: 0, std: 0 }
  const mean = series.reduce((s, x) => s + x, 0) / series.length
  const variance =
    series.reduce((s, x) => s + (x - mean) * (x - mean), 0) / series.length
  return { mean, std: Math.sqrt(Math.max(0, variance)) }
}

function simulateZeroDays(
  currentUnits: number,
  demandPerDay: number,
  horizonDays: number,
  arrivalDayIndex: number | null,
  addedUnits: number
): { zeroDays: number; daysUntilZero: number | null } {
  let onHand = Math.max(0, currentUnits)
  let zeroDays = 0
  let firstZeroDay: number | null = null
  for (let t = 0; t < horizonDays; t++) {
    if (arrivalDayIndex != null && t === arrivalDayIndex) {
      onHand += addedUnits
    }
    const afterDemand = onHand - demandPerDay
    onHand = afterDemand > 0 ? afterDemand : 0
    if (onHand <= 0) {
      zeroDays += 1
      if (firstZeroDay == null) firstZeroDay = t
    }
  }
  return { zeroDays, daysUntilZero: firstZeroDay }
}

function computeNeedByDate(
  currentUnits: number,
  demandPerDay: number,
  maxZeroDaysAllowed: number,
  horizonDays: number,
  todayStartUtc: Date
): { daysUntilZero: number | null; needByDate: string | null } {
  if (demandPerDay <= 0) return { daysUntilZero: null, needByDate: null }
  let onHand = Math.max(0, currentUnits)
  let zeroDays = 0
  let firstZeroDay: number | null = null
  let needByIndex: number | null = null

  for (let t = 0; t < horizonDays; t++) {
    const afterDemand = onHand - demandPerDay
    onHand = afterDemand > 0 ? afterDemand : 0
    if (onHand <= 0) {
      zeroDays += 1
      if (firstZeroDay == null) firstZeroDay = t
      if (zeroDays === maxZeroDaysAllowed + 1) {
        needByIndex = Math.max(0, t - 1)
        break
      }
    }
  }

  if (needByIndex == null) {
    return { daysUntilZero: firstZeroDay, needByDate: null }
  }

  const needBy = addDaysUTC(todayStartUtc, needByIndex)
  return { daysUntilZero: firstZeroDay, needByDate: formatDateYYYYMMDD(needBy) }
}

function bestPriceByVendor(
  vendorPrices: VendorPriceRow[],
  productId: number
): Map<number, number> {
  const map = new Map<number, number>()
  for (const row of vendorPrices) {
    if (row.product_id !== productId) continue
    const price = Number(row.price_per_case ?? 0)
    if (!Number.isFinite(price)) continue
    if (price <= 1) continue // 1 (hoặc <=1) = không bán
    map.set(row.vendor_id, price)
  }
  return map
}

function computeRequiredCasesForVendor(
  product: Product,
  demandPerDay: number,
  demandStd: number,
  vendorLeadTimeDays: number,
  todayStartUtc: Date,
  horizonDays: number,
  maxZeroDaysAllowed: number
): { cases: number; expectedArrivalDate: string } {
  const packSize = product.packSize ?? 24
  const maxUnits = Math.max(0, Number(product.maxStock ?? 0) * packSize)
  const currentUnits = Math.max(0, Number(product.stock ?? 0))

  const arrivalIndex = clamp(vendorLeadTimeDays, 0, horizonDays - 1)
  const expectedArrivalDate = formatDateYYYYMMDD(addDaysUTC(todayStartUtc, arrivalIndex))

  // Safety stock theo biến động: bảo thủ nhẹ để hạn chế stock=0 kéo dài
  // (không dùng service level cố định; bám yêu cầu "0 tối đa 2 ngày")
  const safetyUnits = Math.max(0, Math.ceil(demandStd * 1.0))
  const maxAddUnits = Math.max(0, maxUnits - currentUnits)
  const maxCasesPossible = packSize > 0 ? Math.floor(maxAddUnits / packSize) : 0

  if (demandPerDay <= 0 || maxCasesPossible <= 0) {
    return { cases: 0, expectedArrivalDate }
  }

  // Binary search minimal cases that satisfies zeroDays<=maxZeroDaysAllowed
  let lo = 0
  let hi = maxCasesPossible
  let best = hi
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const addedUnits = mid * packSize
    const sim = simulateZeroDays(
      currentUnits + safetyUnits,
      demandPerDay,
      horizonDays,
      arrivalIndex,
      addedUnits
    )
    if (sim.zeroDays <= maxZeroDaysAllowed) {
      best = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  return { cases: clamp(best, 0, maxCasesPossible), expectedArrivalDate }
}

export function recommendReplenishment(
  data: PosData,
  opts?: {
    horizonDays?: number
    historyDays?: number
    maxZeroDaysAllowed?: number
    leadTimeDefaultDays?: number
    minVendorOrderCasesDefault?: number
  }
): ReplenishmentResult {
  const horizonDays = opts?.horizonDays ?? 30
  const historyDays = opts?.historyDays ?? 28
  const maxZeroDaysAllowed = opts?.maxZeroDaysAllowed ?? 2
  const minVendorOrderCasesDefault = opts?.minVendorOrderCasesDefault ?? 5
  const leadTimeDefaultDays = opts?.leadTimeDefaultDays ?? 3

  const now = new Date()
  const todayStartUtc = startOfDayUTC(now)

  const vendors = (data.vendors ?? []).filter((v) => !v.isHidden)
  const vendorById = new Map<number, Vendor>()
  const leadTimeByVendorId = new Map<number, number>()
  const minOrderCasesByVendorId = new Map<number, number>()
  for (const v of vendors) {
    vendorById.set(v.id, v)
    const ltRaw = Number((v as any).leadTimeDays ?? v.leadTimeDays ?? NaN)
    const lt =
      Number.isFinite(ltRaw) && ltRaw >= 0
        ? Math.floor(ltRaw)
        : parseLeadTimeDaysFromVendorNote(v, leadTimeDefaultDays)
    leadTimeByVendorId.set(v.id, lt)

    const minRaw = Number((v as any).minOrderCases ?? v.minOrderCases ?? NaN)
    const minCases =
      Number.isFinite(minRaw) && minRaw >= 0
        ? Math.floor(minRaw)
        : minVendorOrderCasesDefault
    minOrderCasesByVendorId.set(v.id, minCases)
  }

  const vendorPrices = (data.vendorPrices ?? []) as VendorPriceRow[]
  const products = (data.products ?? []).filter((p) => !p.isHidden)

  const alpha = 2 / (14 + 1) // ~14 ngày

  const productSuggestions: ReplenishmentProductSuggestion[] = []
  const vendorOrdersMap = new Map<number, ReplenishmentVendorOrder>()
  const suggestionByProductId = new Map<number, ReplenishmentProductSuggestion>()

  for (const p of products) {
    const packSize = p.packSize ?? 24
    const minStockCases = Number(p.minStock ?? 0)
    const maxStockCases = Number(p.maxStock ?? 0)
    if (maxStockCases === 0) continue

    const currentUnits = Math.max(0, Number(p.stock ?? 0))
    const minUnits = Math.max(0, minStockCases * packSize)
    const maxUnits = Math.max(0, maxStockCases * packSize)

    const demandSeries = buildDailyDemandSeries(data.sales ?? [], p.id, historyDays, todayStartUtc)
    const ema = emaFromSeries(demandSeries, alpha)
    const { std } = meanAndStd(demandSeries.slice(Math.max(0, demandSeries.length - 14)))
    const demandPerDay = Math.max(0, round2(ema))
    const demandStd = Math.max(0, round2(std))

    const { daysUntilZero, needByDate } = computeNeedByDate(
      currentUnits,
      demandPerDay,
      maxZeroDaysAllowed,
      horizonDays,
      todayStartUtc
    )

    const priceMap = bestPriceByVendor(vendorPrices, p.id)

    let chosenVendorId: number | null = null
    let chosenPricePerCase: number | null = null
    let chosenLeadTime: number | null = null
    let recommendedCases = 0
    let expectedArrivalDate: string | null = null
    const riskFlags: string[] = []

    if (priceMap.size === 0) {
      riskFlags.push('NO_VENDOR_PRICE')
    }

    const needsAtLeastMin = currentUnits < minUnits && minUnits > 0
    const hasDemandSignal = demandPerDay > 0
    const canOrder = priceMap.size > 0 && packSize > 0 && maxUnits > currentUnits

    if (!hasDemandSignal && needsAtLeastMin) {
      riskFlags.push('NO_SALES_HISTORY')
    }

    if ((hasDemandSignal || needsAtLeastMin) && canOrder) {
      // Chọn vendor rẻ nhất trong các vendor có lead time đủ để về trước needByDate (nếu có).
      // Nếu sản phẩm mới (no demand) thì needByDate thường null → pick theo giá rẻ nhất.
      const candidates: {
        vendorId: number
        pricePerCase: number
        leadTimeDays: number
      }[] = []

      for (const [vendorId, pricePerCase] of priceMap.entries()) {
        const lt = leadTimeByVendorId.get(vendorId) ?? leadTimeDefaultDays
        candidates.push({ vendorId, pricePerCase, leadTimeDays: lt })
      }

      const needByIndex =
        needByDate != null
          ? Math.max(
              0,
              Math.floor(
                (parseTimestampAsGMT7(`${needByDate} 00:00:00`).getTime() -
                  todayStartUtc.getTime()) /
                  86400000
              )
            )
          : null

      const feasible =
        needByIndex == null ? candidates : candidates.filter((c) => c.leadTimeDays <= needByIndex)

      const pickPool = feasible.length ? feasible : candidates
      pickPool.sort(
        (a, b) => a.pricePerCase - b.pricePerCase || a.leadTimeDays - b.leadTimeDays
      )
      const pick = pickPool[0]
      if (pick) {
        chosenVendorId = pick.vendorId
        chosenPricePerCase = pick.pricePerCase
        chosenLeadTime = pick.leadTimeDays

        if (hasDemandSignal) {
          const req = computeRequiredCasesForVendor(
            p,
            demandPerDay,
            demandStd,
            chosenLeadTime,
            todayStartUtc,
            horizonDays,
            maxZeroDaysAllowed
          )
          recommendedCases = req.cases
          expectedArrivalDate = req.expectedArrivalDate
        } else {
          // Sản phẩm mới / chưa có demand: đề xuất tối thiểu kéo lên min_stock.
          const maxAddUnits = Math.max(0, maxUnits - currentUnits)
          const maxCasesPossible =
            packSize > 0 ? Math.floor(maxAddUnits / packSize) : 0
          const needToMinUnits = Math.max(0, minUnits - currentUnits)
          const needToMinCases =
            packSize > 0 ? Math.ceil(needToMinUnits / packSize) : 0
          recommendedCases = clamp(needToMinCases, 0, maxCasesPossible)
          const arrivalIndex = clamp(chosenLeadTime, 0, horizonDays - 1)
          expectedArrivalDate = formatDateYYYYMMDD(addDaysUTC(todayStartUtc, arrivalIndex))
        }

        if (!feasible.length && needByDate != null) {
          riskFlags.push('LEAD_TIME_TOO_SLOW')
        }
      }
    }

    // Không vượt max stock và tối thiểu theo min stock (nếu tồn < min thì ưu tiên kéo lên ít nhất min)
    if (recommendedCases > 0) {
      const maxAddUnits = Math.max(0, maxUnits - currentUnits)
      const maxCasesPossible = packSize > 0 ? Math.floor(maxAddUnits / packSize) : 0
      recommendedCases = clamp(recommendedCases, 0, maxCasesPossible)

      if (currentUnits < minUnits) {
        const needToMinUnits = minUnits - currentUnits
        const needToMinCases = Math.ceil(needToMinUnits / packSize)
        recommendedCases = Math.max(recommendedCases, needToMinCases)
        recommendedCases = clamp(recommendedCases, 0, maxCasesPossible)
      }
    }

    const chosenVendor = chosenVendorId ? vendorById.get(chosenVendorId) : null
    const chosenVendorName = chosenVendor?.name ?? (chosenVendorId ? `NCC #${chosenVendorId}` : null)

    productSuggestions.push({
      productId: p.id,
      productName: p.name || `Mã ${p.id}`,
      packSize,
      currentStockUnits: currentUnits,
      minStockCases,
      maxStockCases,
      minStockUnits: minUnits,
      maxStockUnits: maxUnits,
      demandPerDayEma: demandPerDay,
      demandPerDayStd: demandStd,
      daysUntilZero: daysUntilZero != null ? Math.max(0, daysUntilZero) : null,
      needByDate,
      chosenVendorId,
      chosenVendorName,
      leadTimeDays: chosenLeadTime,
      chosenPricePerCase,
      recommendedCases,
      expectedArrivalDate,
      riskFlags
    })
    suggestionByProductId.set(p.id, productSuggestions[productSuggestions.length - 1]!)

    if (chosenVendorId && chosenPricePerCase && recommendedCases > 0) {
      const order = vendorOrdersMap.get(chosenVendorId) ?? {
        vendorId: chosenVendorId,
        vendorName: chosenVendorName || `NCC #${chosenVendorId}`,
        vendorPhone: chosenVendor?.phone ?? null,
        leadTimeDays: chosenLeadTime ?? leadTimeDefaultDays,
        minOrderCases: minOrderCasesByVendorId.get(chosenVendorId) ?? minVendorOrderCasesDefault,
        totalCases: 0,
        totalCost: 0,
        meetsMinOrder: false,
        lines: []
      }
      const lineCost = recommendedCases * chosenPricePerCase
      order.lines.push({
        productId: p.id,
        productName: p.name || `Mã ${p.id}`,
        packSize,
        currentStockUnits: currentUnits,
        minStockUnits: minUnits,
        cases: recommendedCases,
        pricePerCase: chosenPricePerCase,
        lineCost,
        expectedArrivalDate,
        needByDate,
        riskFlags: [...riskFlags]
      })
      order.totalCases += recommendedCases
      order.totalCost += lineCost
      vendorOrdersMap.set(chosenVendorId, order)
    }
  }

  // Enforce min order 5 cases per vendor: điều chỉnh tối thiểu theo chi phí tăng thêm
  // Heuristic: ưu tiên chuyển dòng từ vendor khác sang vendor thiếu (nếu vendor thiếu có bán sản phẩm đó)
  const allOrders = Array.from(vendorOrdersMap.values())
  const orderByVendorId = new Map<number, ReplenishmentVendorOrder>()
  for (const o of allOrders) orderByVendorId.set(o.vendorId, o)

  // Precompute min price across vendors per product (để đo "thiệt" khi mua ở vendor không rẻ nhất)
  const minPriceAcrossVendorsByProductId = new Map<number, number>()
  for (const row of vendorPrices) {
    const price = Number((row as any)?.price_per_case ?? 0)
    if (!Number.isFinite(price) || price <= 1) continue
    const best = minPriceAcrossVendorsByProductId.get(row.product_id)
    if (best == null || price < best) {
      minPriceAcrossVendorsByProductId.set(row.product_id, price)
    }
  }

  for (const order of allOrders) {
    const minOrderCases = Math.max(0, Number(order.minOrderCases ?? minVendorOrderCasesDefault) || 0)
    order.minOrderCases = minOrderCases
    if (order.totalCases >= minOrderCases) continue
    const need = minOrderCases - order.totalCases

    // Tìm các sản phẩm hiện đang đặt ở vendor khác, nhưng vendor này cũng có giá và không vi phạm lead time
    const candidates: {
      fromVendorId: number
      productId: number
      shiftCases: number
      deltaCostPerCase: number
      priceTo: number
      priceFrom: number
      toLeadTime: number
    }[] = []

    for (const ps of productSuggestions) {
      if (ps.recommendedCases <= 0) continue
      if (!ps.chosenVendorId || ps.chosenVendorId === order.vendorId) continue

      const toPrice = bestPriceByVendor((data.vendorPrices ?? []) as VendorPriceRow[], ps.productId).get(order.vendorId)
      if (!toPrice) continue

      const fromPrice = ps.chosenPricePerCase ?? 0
      if (!fromPrice) continue

      const toLead = leadTimeByVendorId.get(order.vendorId) ?? leadTimeDefaultDays
      if (ps.needByDate) {
        const needByIndex = Math.max(
          0,
          Math.floor(
            (parseTimestampAsGMT7(`${ps.needByDate} 00:00:00`).getTime() -
              todayStartUtc.getTime()) /
              86400000
          )
        )
        if (toLead > needByIndex) continue
      }

      candidates.push({
        fromVendorId: ps.chosenVendorId,
        productId: ps.productId,
        shiftCases: ps.recommendedCases,
        deltaCostPerCase: toPrice - fromPrice,
        priceTo: toPrice,
        priceFrom: fromPrice,
        toLeadTime: toLead
      })
    }

    candidates.sort((a, b) => a.deltaCostPerCase - b.deltaCostPerCase)

    let remaining = need
    for (const c of candidates) {
      if (remaining <= 0) break
      const shift = Math.min(c.shiftCases, remaining)
      if (shift <= 0) continue

      const fromOrder = orderByVendorId.get(c.fromVendorId)
      if (!fromOrder) continue

      // giảm ở from
      const fromLine = fromOrder.lines.find((l) => l.productId === c.productId)
      if (!fromLine) continue
      fromLine.cases -= shift
      fromLine.lineCost = fromLine.cases * fromLine.pricePerCase
      fromOrder.totalCases -= shift
      fromOrder.totalCost -= shift * c.priceFrom
      if (fromLine.cases <= 0) {
        fromOrder.lines = fromOrder.lines.filter((l) => l.productId !== c.productId)
      }

      // tăng ở to
      const toLine = order.lines.find((l) => l.productId === c.productId)
      if (toLine) {
        toLine.cases += shift
        toLine.pricePerCase = c.priceTo
        toLine.lineCost = toLine.cases * toLine.pricePerCase
      } else {
        const ps = productSuggestions.find((x) => x.productId === c.productId)
        order.lines.push({
          productId: c.productId,
          productName: ps?.productName ?? `Mã ${c.productId}`,
          packSize: ps?.packSize ?? 24,
          currentStockUnits: ps?.currentStockUnits ?? 0,
          minStockUnits: ps?.minStockUnits ?? 0,
          cases: shift,
          pricePerCase: c.priceTo,
          lineCost: shift * c.priceTo,
          expectedArrivalDate: formatDateYYYYMMDD(addDaysUTC(todayStartUtc, clamp(c.toLeadTime, 0, horizonDays - 1))),
          needByDate: ps?.needByDate ?? null,
          riskFlags: ['VENDOR_MIN_ORDER_ADJUST']
        })
      }
      order.totalCases += shift
      order.totalCost += shift * c.priceTo

      // cập nhật product suggestion vendor chosen nếu chuyển toàn bộ (để UI nhìn hợp lý)
      const psIdx = productSuggestions.findIndex((x) => x.productId === c.productId)
      if (psIdx >= 0 && productSuggestions[psIdx]!.chosenVendorId === c.fromVendorId) {
        const movedAll = (productSuggestions[psIdx]!.recommendedCases ?? 0) === shift
        if (movedAll) {
          productSuggestions[psIdx]!.chosenVendorId = order.vendorId
          productSuggestions[psIdx]!.chosenVendorName = order.vendorName
          productSuggestions[psIdx]!.chosenPricePerCase = c.priceTo
          productSuggestions[psIdx]!.leadTimeDays = c.toLeadTime
          productSuggestions[psIdx]!.riskFlags = [
            ...new Set([...(productSuggestions[psIdx]!.riskFlags ?? []), 'VENDOR_MIN_ORDER_ADJUST'])
          ]
        }
      }

      remaining -= shift
    }

    // Nếu vẫn thiếu (vd chỉ có 1 vendor, không có gì để shift) -> top-up thêm thùng từ chính vendor đó.
    // Ưu tiên khẩn cấp:
    // 1) Ưu tiên các sản phẩm stock < min_stock_units (bao gồm stock=0)
    // 2) Sau đó ưu tiên sản phẩm bán chạy hơn (demand cao)
    // 3) Sau đó mới ưu tiên giá nhập tốt hơn (delta nhỏ hơn)
    // 4) Hạn chế vượt max_stock, nhưng cho phép vượt nếu cần để đạt min order.
    if (remaining > 0) {
      // Tính plannedCasesByProduct trong order hiện tại
      const plannedCasesByProduct = new Map<number, number>()
      for (const line of order.lines) {
        plannedCasesByProduct.set(
          line.productId,
          (plannedCasesByProduct.get(line.productId) ?? 0) + line.cases
        )
      }

      type TopUpCandidate = {
        productId: number
        packSize: number
        extraHeadroomCases: number // số thùng còn có thể thêm trước khi chạm max_stock
        isBelowMin: boolean
        demand: number
        delta: number // chênh giá so với vendor rẻ nhất (>=0)
        daysOverMaxIfOneMore: number // số ngày vượt max_stock nếu thêm 1 thùng (dùng cho Phase_B)
      }

      function buildTopUpCandidate(productId: number): TopUpCandidate | null {
        const ps = suggestionByProductId.get(productId)
        if (!ps) return null
        const packSize = ps.packSize || 24
        if (packSize <= 0) return null

        const line = order.lines.find((l) => l.productId === productId)
        if (!line) return null

        // Vendor price (đang mua ở vendor này)
        const vendorPrice = Number(line.pricePerCase ?? 0)
        if (!Number.isFinite(vendorPrice) || vendorPrice <= 1) return null

        const plannedCases = plannedCasesByProduct.get(productId) ?? 0
        const plannedUnits = plannedCases * packSize
        const headroomUnits = Math.max(
          0,
          (ps.maxStockUnits ?? 0) - ((ps.currentStockUnits ?? 0) + plannedUnits)
        )
        const extraHeadroomCases = Math.floor(headroomUnits / packSize)

        const demand = Math.max(0, Number(ps.demandPerDayEma ?? 0))
        const minPrice = minPriceAcrossVendorsByProductId.get(productId) ?? vendorPrice
        const delta = Math.max(0, vendorPrice - minPrice)
        const isBelowMin = (ps.currentStockUnits ?? 0) < (ps.minStockUnits ?? 0)

        // Số ngày vượt max_stock nếu thêm 1 thùng: excess / demand
        const totalAfterOneMore = (ps.currentStockUnits ?? 0) + plannedUnits + packSize
        const excessAfterOneMore = Math.max(0, totalAfterOneMore - (ps.maxStockUnits ?? 0))
        const daysOverMaxIfOneMore =
          excessAfterOneMore <= 0 ? 0 : demand > 0 ? excessAfterOneMore / demand : Infinity

        return {
          productId,
          packSize,
          extraHeadroomCases,
          isBelowMin,
          demand,
          delta,
          daysOverMaxIfOneMore
        }
      }

      function sortCandidates(a: TopUpCandidate, b: TopUpCandidate) {
        // stock<min trước
        if (a.isBelowMin !== b.isBelowMin) return a.isBelowMin ? -1 : 1
        // bán chạy trước
        if (a.demand !== b.demand) return b.demand - a.demand
        // giá tốt trước (delta nhỏ)
        if (a.delta !== b.delta) return a.delta - b.delta
        return a.productId - b.productId
      }

      function sortCandidatesPhaseB(a: TopUpCandidate, b: TopUpCandidate) {
        // stock<min trước
        if (a.isBelowMin !== b.isBelowMin) return a.isBelowMin ? -1 : 1
        // ít ngày vượt max_stock hơn trước (= bán nhanh so với lượng vượt)
        if (a.daysOverMaxIfOneMore !== b.daysOverMaxIfOneMore)
          return a.daysOverMaxIfOneMore - b.daysOverMaxIfOneMore
        // giá tốt trước (delta nhỏ)
        if (a.delta !== b.delta) return a.delta - b.delta
        return a.productId - b.productId
      }

      function applyTopUpOneCase(
        c: TopUpCandidate,
        flags: { exceedMax: boolean; emergency: boolean }
      ) {
        const line = order.lines.find((l) => l.productId === c.productId)
        if (!line) return false

        line.cases += 1
        line.lineCost = line.cases * line.pricePerCase

        if (!line.riskFlags.includes('VENDOR_MIN_ORDER_TOP_UP')) {
          line.riskFlags.push('VENDOR_MIN_ORDER_TOP_UP')
        }
        if (flags.exceedMax && !line.riskFlags.includes('VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX')) {
          line.riskFlags.push('VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX')
        }
        if (flags.emergency && !line.riskFlags.includes('EMERGENCY_STOCK_BELOW_MIN')) {
          line.riskFlags.push('EMERGENCY_STOCK_BELOW_MIN')
        }

        order.totalCases += 1
        order.totalCost += line.pricePerCase

        const ps = suggestionByProductId.get(c.productId)
        if (ps) {
          ps.recommendedCases += 1
          const extraFlags = [
            'VENDOR_MIN_ORDER_TOP_UP',
            ...(flags.exceedMax ? ['VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX'] : []),
            ...(flags.emergency ? ['EMERGENCY_STOCK_BELOW_MIN'] : [])
          ]
          ps.riskFlags = [...new Set([...(ps.riskFlags ?? []), ...extraFlags])]
        }

        plannedCasesByProduct.set(
          c.productId,
          (plannedCasesByProduct.get(c.productId) ?? 0) + 1
        )
        return true
      }

      // Phase_A: top-up trong giới hạn max_stock (không vượt)
      const phaseACandidates: TopUpCandidate[] = []
      for (const line of order.lines) {
        const c = buildTopUpCandidate(line.productId)
        if (!c) continue
        if (c.extraHeadroomCases <= 0) continue
        phaseACandidates.push(c)
      }
      phaseACandidates.sort(sortCandidates)

      while (remaining > 0 && phaseACandidates.length) {
        const c = phaseACandidates[0]!
        if (c.extraHeadroomCases <= 0) {
          phaseACandidates.shift()
          continue
        }
        const ok = applyTopUpOneCase(c, { exceedMax: false, emergency: c.isBelowMin })
        if (!ok) {
          phaseACandidates.shift()
          continue
        }
        c.extraHeadroomCases -= 1
        remaining -= 1
        if (c.extraHeadroomCases <= 0) {
          phaseACandidates.shift()
        }
      }

      // Phase_A2: nếu vẫn thiếu, thêm sản phẩm MỚI chưa có trong đơn nhưng vendor có bán và còn headroom dưới max_stock.
      // Ưu tiên Phase_A2 trước Phase_B để giảm thiểu việc vượt max_stock của sản phẩm đã có.
      if (remaining > 0) {
        type A2Candidate = {
          productId: number
          packSize: number
          extraHeadroomCases: number
          isBelowMin: boolean
          demand: number
          delta: number
          pricePerCase: number
        }

        const phaseA2Candidates: A2Candidate[] = []

        for (const ps of productSuggestions) {
          if (order.lines.some((l) => l.productId === ps.productId)) continue

          const vendorPrice = bestPriceByVendor(
            vendorPrices as VendorPriceRow[],
            ps.productId
          ).get(order.vendorId)
          if (!vendorPrice || vendorPrice <= 1) continue

          const packSz = ps.packSize || 24
          if (packSz <= 0) continue

          const headroomUnits = Math.max(0, (ps.maxStockUnits ?? 0) - (ps.currentStockUnits ?? 0))
          const extraHeadroomCases = Math.floor(headroomUnits / packSz)
          if (extraHeadroomCases <= 0) continue

          if (ps.needByDate) {
            const needByIdx = Math.max(
              0,
              Math.floor(
                (parseTimestampAsGMT7(`${ps.needByDate} 00:00:00`).getTime() -
                  todayStartUtc.getTime()) /
                  86400000
              )
            )
            const toLead = leadTimeByVendorId.get(order.vendorId) ?? leadTimeDefaultDays
            if (toLead > needByIdx) continue
          }

          const demand = Math.max(0, Number(ps.demandPerDayEma ?? 0))
          const minPrice = minPriceAcrossVendorsByProductId.get(ps.productId) ?? vendorPrice
          const delta = Math.max(0, vendorPrice - minPrice)
          const isBelowMin = (ps.currentStockUnits ?? 0) < (ps.minStockUnits ?? 0)

          phaseA2Candidates.push({
            productId: ps.productId,
            packSize: packSz,
            extraHeadroomCases,
            isBelowMin,
            demand,
            delta,
            pricePerCase: vendorPrice
          })
        }

        phaseA2Candidates.sort((a, b) => {
          if (a.isBelowMin !== b.isBelowMin) return a.isBelowMin ? -1 : 1
          if (a.demand !== b.demand) return b.demand - a.demand
          if (a.delta !== b.delta) return a.delta - b.delta
          return a.productId - b.productId
        })

        let a2i = 0
        while (remaining > 0 && a2i < phaseA2Candidates.length) {
          const c = phaseA2Candidates[a2i]!
          if (c.extraHeadroomCases <= 0) {
            a2i++
            continue
          }

          const toLead = leadTimeByVendorId.get(order.vendorId) ?? leadTimeDefaultDays
          const arrIdx = clamp(toLead, 0, horizonDays - 1)
          const ps = suggestionByProductId.get(c.productId)

          let line = order.lines.find((l) => l.productId === c.productId)
          if (!line) {
            line = {
              productId: c.productId,
              productName: ps?.productName ?? `Mã ${c.productId}`,
              packSize: c.packSize,
              currentStockUnits: ps?.currentStockUnits ?? 0,
              minStockUnits: ps?.minStockUnits ?? 0,
              cases: 0,
              pricePerCase: c.pricePerCase,
              lineCost: 0,
              expectedArrivalDate: formatDateYYYYMMDD(addDaysUTC(todayStartUtc, arrIdx)),
              needByDate: ps?.needByDate ?? null,
              riskFlags: []
            }
            order.lines.push(line)
            plannedCasesByProduct.set(c.productId, 0)
          }

          line.cases += 1
          line.lineCost = line.cases * line.pricePerCase
          if (!line.riskFlags.includes('VENDOR_MIN_ORDER_TOP_UP')) {
            line.riskFlags.push('VENDOR_MIN_ORDER_TOP_UP')
          }

          order.totalCases += 1
          order.totalCost += c.pricePerCase

          plannedCasesByProduct.set(
            c.productId,
            (plannedCasesByProduct.get(c.productId) ?? 0) + 1
          )

          if (ps) {
            ps.recommendedCases += 1
            ps.riskFlags = [...new Set([...(ps.riskFlags ?? []), 'VENDOR_MIN_ORDER_TOP_UP'])]
            if (!ps.chosenVendorId) {
              ps.chosenVendorId = order.vendorId
              ps.chosenVendorName = order.vendorName
              ps.chosenPricePerCase = c.pricePerCase
              ps.leadTimeDays = toLead
              ps.expectedArrivalDate = formatDateYYYYMMDD(addDaysUTC(todayStartUtc, arrIdx))
            }
          }

          c.extraHeadroomCases -= 1
          remaining -= 1

          if (c.extraHeadroomCases <= 0) {
            a2i++
          }
        }
      }

      // Phase_B: nếu vẫn thiếu, cho phép vượt max_stock để cố đạt min order
      if (remaining > 0) {
        while (remaining > 0) {
          // Rebuild và sort mỗi vòng vì daysOverMaxIfOneMore thay đổi khi plannedCases tăng
          const freshB: TopUpCandidate[] = []
          for (const line of order.lines) {
            const c = buildTopUpCandidate(line.productId)
            if (!c) continue
            freshB.push(c)
          }
          if (!freshB.length) break
          freshB.sort(sortCandidatesPhaseB)
          const c = freshB[0]!
          const ok = applyTopUpOneCase(c, { exceedMax: true, emergency: c.isBelowMin })
          if (!ok) break
          // Không giới hạn theo extraHeadroomCases nữa (đang vượt max).
          remaining -= 1
        }
      }
    }

    if (order.totalCases < minOrderCases) {
      order.meetsMinOrder = false
      order.lines.forEach((l) => {
        if (!l.riskFlags.includes('VENDOR_MIN_ORDER_NOT_MET')) {
          l.riskFlags.push('VENDOR_MIN_ORDER_NOT_MET')
        }
      })
    }
  }

  // Pass cuối: sau khi đã shift giữa các vendor, đảm bảo các đơn "khẩn cấp" (stock < min) vẫn cố đạt min order.
  // Lý do: một đơn có thể được top-up ở lượt xử lý của nó, nhưng bị shift ra ở lượt vendor khác sau đó.
  for (const order of allOrders) {
    const minOrderCases = Math.max(0, Number(order.minOrderCases ?? minVendorOrderCasesDefault) || 0)
    order.minOrderCases = minOrderCases
    if (order.totalCases >= minOrderCases) continue
    const hasEmergency = order.lines.some(
      (l) => (l.currentStockUnits ?? 0) < (l.minStockUnits ?? 0)
    )
    if (!hasEmergency) continue

    let remaining = minOrderCases - order.totalCases
    if (remaining <= 0) continue

    // Planned cases hiện tại theo product trong order
    const plannedCasesByProduct = new Map<number, number>()
    for (const line of order.lines) {
      plannedCasesByProduct.set(
        line.productId,
        (plannedCasesByProduct.get(line.productId) ?? 0) + line.cases
      )
    }

    type TopUpCandidate = {
      productId: number
      extraHeadroomCases: number
      isBelowMin: boolean
      demand: number
      delta: number
    }

    function buildCandidate(productId: number): TopUpCandidate | null {
      const ps = suggestionByProductId.get(productId)
      if (!ps) return null
      const packSize = ps.packSize || 24
      if (packSize <= 0) return null

      const line = order.lines.find((l) => l.productId === productId)
      if (!line) return null

      const vendorPrice = Number(line.pricePerCase ?? 0)
      if (!Number.isFinite(vendorPrice) || vendorPrice <= 1) return null

      const plannedCases = plannedCasesByProduct.get(productId) ?? 0
      const plannedUnits = plannedCases * packSize
      const headroomUnits = Math.max(
        0,
        (ps.maxStockUnits ?? 0) - ((ps.currentStockUnits ?? 0) + plannedUnits)
      )
      const extraHeadroomCases = Math.floor(headroomUnits / packSize)

      const demand = Math.max(0, Number(ps.demandPerDayEma ?? 0))
      const minPrice = minPriceAcrossVendorsByProductId.get(productId) ?? vendorPrice
      const delta = Math.max(0, vendorPrice - minPrice)
      const isBelowMin = (ps.currentStockUnits ?? 0) < (ps.minStockUnits ?? 0)

      return { productId, extraHeadroomCases, isBelowMin, demand, delta }
    }

    function sortCandidates(a: TopUpCandidate, b: TopUpCandidate) {
      if (a.isBelowMin !== b.isBelowMin) return a.isBelowMin ? -1 : 1
      if (a.demand !== b.demand) return b.demand - a.demand
      if (a.delta !== b.delta) return a.delta - b.delta
      return a.productId - b.productId
    }

    const candidates: TopUpCandidate[] = []
    for (const line of order.lines) {
      const c = buildCandidate(line.productId)
      if (c) candidates.push(c)
    }
    candidates.sort(sortCandidates)

    while (remaining > 0 && candidates.length) {
      // Ưu tiên không vượt max nếu còn headroom; nếu không có thì cho phép vượt.
      const idx = candidates.findIndex((c) => c.extraHeadroomCases > 0)
      const c = candidates[idx >= 0 ? idx : 0]!
      const exceedMax = c.extraHeadroomCases <= 0

      const line = order.lines.find((l) => l.productId === c.productId)
      if (!line) {
        candidates.splice(idx >= 0 ? idx : 0, 1)
        continue
      }

      line.cases += 1
      line.lineCost = line.cases * line.pricePerCase
      if (!line.riskFlags.includes('VENDOR_MIN_ORDER_TOP_UP')) {
        line.riskFlags.push('VENDOR_MIN_ORDER_TOP_UP')
      }
      if (exceedMax && !line.riskFlags.includes('VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX')) {
        line.riskFlags.push('VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX')
      }
      if (c.isBelowMin && !line.riskFlags.includes('EMERGENCY_STOCK_BELOW_MIN')) {
        line.riskFlags.push('EMERGENCY_STOCK_BELOW_MIN')
      }

      order.totalCases += 1
      order.totalCost += line.pricePerCase

      const ps = suggestionByProductId.get(c.productId)
      if (ps) {
        ps.recommendedCases += 1
        const extraFlags = [
          'VENDOR_MIN_ORDER_TOP_UP',
          ...(exceedMax ? ['VENDOR_MIN_ORDER_TOP_UP_EXCEED_MAX'] : []),
          ...(c.isBelowMin ? ['EMERGENCY_STOCK_BELOW_MIN'] : [])
        ]
        ps.riskFlags = [...new Set([...(ps.riskFlags ?? []), ...extraFlags])]
      }

      plannedCasesByProduct.set(
        c.productId,
        (plannedCasesByProduct.get(c.productId) ?? 0) + 1
      )
      c.extraHeadroomCases -= 1
      remaining -= 1
    }
  }

  // Cleanup empty orders and finalize meetsMinOrder
  const vendorOrders: ReplenishmentVendorOrder[] = Array.from(orderByVendorId.values())
    .filter((o) => o.lines.length > 0 && o.totalCases > 0)
    .map((o) => {
      o.lines = o.lines.filter((l) => l.cases > 0)
      o.totalCases = o.lines.reduce((s, l) => s + l.cases, 0)
      o.totalCost = o.lines.reduce((s, l) => s + l.lineCost, 0)
      const minOrderCases = Math.max(0, Number(o.minOrderCases ?? minVendorOrderCasesDefault) || 0)
      o.minOrderCases = minOrderCases
      o.meetsMinOrder = o.totalCases >= minOrderCases
      return o
    })
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))

  // Final sorting products: urgent first, then by needByDate
  productSuggestions.sort((a, b) => {
    const aNeed = a.needByDate ?? '9999-12-31'
    const bNeed = b.needByDate ?? '9999-12-31'
    return aNeed.localeCompare(bNeed) || a.productName.localeCompare(b.productName)
  })

  return {
    generatedAt: new Date().toISOString(),
    horizonDays,
    maxZeroDaysAllowed,
    minVendorOrderCases: minVendorOrderCasesDefault,
    products: productSuggestions,
    vendorOrders
  }
}

