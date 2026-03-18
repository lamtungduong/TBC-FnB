<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useApiOrigin } from '~/composables/useApiOrigin'
import { parseTimestampAsGMT7 } from '~/utils/date'
import type { Product, StockImport, Vendor } from '~/composables/usePosStore'
import { usePosStore } from '~/composables/usePosStore'

const {
  products,
  importStock,
  imports,
  deleteImport,
  vendors,
  addVendor,
  updateVendor,
  deleteVendor,
  saveVendorPrice,
  vendorPrices: vendorPriceRows
} = usePosStore()
const { getApiUrl, apiFetch } = useApiOrigin()

type ReplenishmentVendorOrderLine = {
  productId: number
  productName: string
  packSize: number
  currentStockUnits: number
  minStockUnits: number
  cases: number
  pricePerCase: number
}

type ReplenishmentVendorOrder = {
  vendorId: number
  vendorName: string
  vendorPhone: string | null
  leadTimeDays: number
  totalCases: number
  totalCost: number
  meetsMinOrder: boolean
  lines: ReplenishmentVendorOrderLine[]
}

type ReplenishmentResult = {
  generatedAt: string
  vendorOrders: ReplenishmentVendorOrder[]
}

const replenishment = ref<ReplenishmentResult | null>(null)
const replenishmentLoading = ref(false)
const replenishmentError = ref<string | null>(null)
const isReplenishmentCollapsed = ref(true)
const replenishmentUserToggled = ref(false)

function isEmergencyOrder(order: ReplenishmentVendorOrder): boolean {
  return (order.lines ?? []).some(
    (l) => l.currentStockUnits === 0 || l.currentStockUnits < l.minStockUnits
  )
}

function toggleReplenishmentCollapsed() {
  replenishmentUserToggled.value = true
  isReplenishmentCollapsed.value = !isReplenishmentCollapsed.value
}

function normalizePhoneDigits(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''
  return digits.length > 10 ? digits.slice(-10) : digits
}

function formatPhoneDots(phone: string | null | undefined): string {
  if (!phone) return '-'
  const normalized = normalizePhoneDigits(phone)
  if (!normalized) return '-'
  // Yêu cầu format xxxx.xxx.xxx (4-3-3). Nếu không đủ 10 số thì fallback hiển thị số thô.
  if (normalized.length !== 10) return normalized
  return `${normalized.slice(0, 4)}.${normalized.slice(4, 7)}.${normalized.slice(7)}`
}

function buildVendorOrderMessage(order: ReplenishmentVendorOrder): string {
  const lines = (order.lines ?? [])
    .filter((l) => (l.cases ?? 0) > 0)
    .map(
      (l) =>
        `- ${(l.productName || `Mã ${l.productId}`).trim()} * ${l.cases} (thùng)`
    )
  const itemsBlock = lines.length ? lines.join('\n') : '- (Không có sản phẩm)'

  return [
    'Shop ơi, em đặt hàng với.',
    itemsBlock,
    '',
    'Địa chỉ: 51 Lê Đại Hành, Hai Bà Trưng, Hà Nội',
    'SĐT: 0912.199.120'
  ].join('\n')
}

async function copyOrderMessage(order: ReplenishmentVendorOrder) {
  const text = buildVendorOrderMessage(order)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // best-effort
  }
}

async function copyPhoneAndOpenZalo(phone: string | null | undefined) {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return
  try {
    await navigator.clipboard.writeText(digits)
  } catch {
    // best-effort: clipboard có thể bị chặn nếu không phải HTTPS/permission
  }
  window.location.href = `zalo://conversation?id=${digits}`
}

async function loadReplenishment() {
  try {
    replenishmentLoading.value = true
    replenishmentError.value = null
    const res = await apiFetch<ReplenishmentResult>('/api/replenishment')
    replenishment.value = res ?? null
    if (!replenishmentUserToggled.value) {
      const hasOrders = Boolean(replenishment.value?.vendorOrders?.length)
      isReplenishmentCollapsed.value = !hasOrders
    }
  } catch (err: any) {
    const message = err?.data?.message ?? err?.message ?? String(err)
    replenishmentError.value = message
    replenishment.value = null
  } finally {
    replenishmentLoading.value = false
  }
}

function applyVendorSuggestion(order: ReplenishmentVendorOrder) {
  selectedVendorId.value = order.vendorId
  // Reset toàn bộ số lượng về 0 trước, để tránh trộn nhiều vendor
  for (const item of productsWithRows.value) {
    item.row.cases = 0
    item.row.pricePerCase = getPriceForVendorForPurchase(item.product.id, order.vendorId)
    item.row.packSize = item.product.packSize ?? 24
  }
  for (const line of order.lines) {
    if (!rows[line.productId]) {
      const p = products.value.find((x) => x.id === line.productId)
      rows[line.productId] = {
        cases: 0,
        pricePerCase: 0,
        packSize: p?.packSize ?? 24
      }
    }
    rows[line.productId].cases = line.cases
    rows[line.productId].pricePerCase = line.pricePerCase
  }
}

type PurchaseRow = {
  cases: number
  pricePerCase: number
  packSize: number
}

const rows = reactive<Record<number, PurchaseRow>>({})
const saving = ref(false)
const deletingId = ref<number | null>(null)
const isVendorsCardCollapsed = ref(true)
const selectedVendorId = ref<number | null>(null)

const newVendor = reactive<{ name: string; phone: string; note: string }>({
  name: '',
  phone: '',
  note: ''
})

// Bản đồ giá local theo (productId-vendorId) để bind vào input
const vendorPriceMap = reactive<Record<string, number>>({})

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

function getLastImportPriceByVendor(
  productId: number,
  vendorId: number | null
): number {
  if (!vendorId) return 0
  for (let i = imports.value.length - 1; i >= 0; i--) {
    const entry = imports.value[i]
    if (entry.vendorId !== vendorId) continue
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
          // Giá mặc định khi chưa chọn nhà cung cấp
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

function updateCases(row: PurchaseRow, delta: number) {
  const next = (row.cases || 0) + delta
  row.cases = next < 0 ? 0 : next
}

const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))
function productImageUrl(product: Product) {
  if (!product.image) return ''
  if (product.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(product.id)] ?? 0
    return getApiUrl(`/api/blob-image?url=${encodeURIComponent(product.image)}&_t=${t}`)
  }
  return product.image.startsWith('http') ? product.image : ''
}

const visiblePurchaseRows = computed(() => {
  const vid = Number(selectedVendorId.value || 0)
  if (!vid) {
    return productsWithRows.value
  }
  return productsWithRows.value.filter(
    (item) => getPriceForVendorForPurchase(item.product.id, vid) !== 1
  )
})

const totalAmount = computed(() =>
  visiblePurchaseRows.value.reduce(
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

/** Hiển thị giờ đúng như trên DB (GMT+7 "YYYY-MM-DD HH:mm:ss"). */
function formatImportTimestamp(ts: string) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) return ts
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hours = String(d.getUTCHours()).padStart(2, '0')
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const seconds = String(d.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/** Lịch sử nhập hàng sắp xếp theo ID giảm dần: đơn mới (ID lớn) lên trên cùng. */
const importsNewestFirst = computed(() =>
  [...imports.value].sort((a, b) => b.id - a.id)
)

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
    await importStock(payload, selectedVendorId.value ?? null)

    for (const item of productsWithRows.value) {
      item.row.cases = 0
      item.row.pricePerCase = 0
      item.row.packSize = item.product.packSize ?? 24
    }
  } finally {
    saving.value = false
  }
}

function findVendorNameById(id: number | null | undefined): string {
  if (!id) return '-'
  const v = vendors.value.find((x) => x.id === id)
  return v?.name || `NCC #${id}`
}

function vendorPriceKey(productId: number, vendorId: number): string {
  return `${productId}-${vendorId}`
}

function getLastImportInfoByVendor(
  productId: number,
  vendorId: number | null
): { pricePerCase: number; timestamp: string } | null {
  if (!vendorId) return null
  let best: { pricePerCase: number; timestamp: string } | null = null
  for (const entry of imports.value) {
    if (entry.vendorId !== vendorId) continue
    const found = entry.items.find((item) => item.productId === productId)
    if (!found) continue
    if (!best) {
      best = { pricePerCase: found.pricePerCase, timestamp: entry.timestamp }
      continue
    }
    const tCurrent = parseTimestampAsGMT7(entry.timestamp).getTime()
    const tBest = parseTimestampAsGMT7(best.timestamp).getTime()
    if (tCurrent > tBest) {
      best = { pricePerCase: found.pricePerCase, timestamp: entry.timestamp }
    }
  }
  return best
}

function getEffectiveVendorPriceFromSources(
  productId: number,
  vendorId: number
): number {
  const row = vendorPriceRows.value.find(
    (r) => r.product_id === productId && r.vendor_id === vendorId
  )
  const manualPrice =
    typeof row?.price_per_case === 'number' ? row.price_per_case : null
  const manualTs = row?.updated_at || null

  const lastImport = getLastImportInfoByVendor(productId, vendorId)

  if (manualPrice == null && !lastImport) {
    return 0
  }

  if (manualPrice != null && !lastImport) {
    return manualPrice
  }

  if (lastImport && manualPrice == null) {
    return lastImport.pricePerCase
  }

  if (lastImport && manualPrice != null) {
    if (!manualTs) {
      return lastImport.pricePerCase
    }
    const tManual = parseTimestampAsGMT7(manualTs).getTime()
    const tImport = parseTimestampAsGMT7(lastImport.timestamp).getTime()
    return tManual >= tImport ? manualPrice : lastImport.pricePerCase
  }

  return 0
}

// Giá dùng cho bảng Giá nhập hàng (có caching local theo từng ô)
function getVendorPrice(productId: number, vendorId: number): number {
  const key = vendorPriceKey(productId, vendorId)
  if (key in vendorPriceMap) {
    return vendorPriceMap[key] ?? 0
  }
  const value = getEffectiveVendorPriceFromSources(productId, vendorId)
  vendorPriceMap[key] = value
  return value
}

// Giá dùng cho Card Nhập hàng: không phụ thuộc cache local
function getPriceForVendorForPurchase(
  productId: number,
  vendorId: number
): number {
  return getEffectiveVendorPriceFromSources(productId, vendorId)
}

function setVendorPrice(productId: number, vendorId: number, value: string) {
  const trimmed = value.trim()
  // Dấu "-" được hiểu là tắt giá cho vendor này (ẩn dòng ở card Nhập hàng)
  const numeric =
    trimmed === '-'
      ? -1
      : Number(trimmed.replace(/[^0-9]/g, '') || '0')
  const key = vendorPriceKey(productId, vendorId)
  vendorPriceMap[key] = numeric
  saveVendorPrice(productId, vendorId, numeric)
}

function formatVendorPriceDisplay(v: number): string {
  if (v === -1) return '-'
  if (!v) return '0'
  return v.toLocaleString('vi-VN')
}

watch(
  selectedVendorId,
  (vendorId) => {
    const vid = Number(vendorId || 0)
    // Khi chưa chọn nhà cung cấp (vid = 0): tất cả giá = 0, không ẩn dòng nào
    if (!vid) {
      for (const item of productsWithRows.value) {
        item.row.pricePerCase = 0
      }
      return
    }
    // Khi đã chọn nhà cung cấp: lấy giá theo (sản phẩm, vendor) từ DB hoặc lịch sử nhập
    for (const item of productsWithRows.value) {
      const price = getPriceForVendorForPurchase(item.product.id, vid)
      item.row.pricePerCase = price
    }
  }
)

async function handleAddVendor() {
  if (!newVendor.name.trim()) return
  await addVendor({
    name: newVendor.name.trim(),
    phone: newVendor.phone.trim(),
    note: newVendor.note.trim()
  })
  newVendor.name = ''
  newVendor.phone = ''
  newVendor.note = ''
}

async function handleVendorBlur(v: Vendor) {
  await updateVendor(v.id, {
    name: v.name,
    phone: v.phone,
    note: v.note
  })
}

async function handleDeleteVendor(id: number) {
  const ok = window.confirm('Bạn có chắc muốn xóa nhà cung cấp này?')
  if (!ok) return
  await deleteVendor(id)
}

async function handleToggleVendorHidden(v: Vendor) {
  await updateVendor(v.id, {
    isHidden: !v.isHidden
  })
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

onMounted(() => {
  // Best-effort: chỉ để hiện gợi ý, không ảnh hưởng nhập hàng nếu lỗi.
  loadReplenishment()
})
</script>

<template>
  <div class="purchase-page">
    <section class="card vendors-card">
      <div
        class="vendors-card-header"
        @click="isVendorsCardCollapsed = !isVendorsCardCollapsed"
      >
        <h3 class="vendors-card-title">
          Nhà cung cấp
        </h3>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
        >
          {{ isVendorsCardCollapsed ? 'Mở' : 'Thu gọn' }}
        </button>
      </div>

      <div
        v-if="!isVendorsCardCollapsed"
        class="vendors-card-body"
      >
        <!-- Card con: Nhà cung cấp -->
        <section class="card vendors-subcard">
          <h4 class="vendors-subcard-title">
            Nhà cung cấp
          </h4>
          <div class="products-table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th style="width: 50px;">STT</th>
                  <th>Tên</th>
                  <th style="width: 120px;">SĐT</th>
                  <th>Ghi chú</th>
                  <th style="width: 90px;">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(v, idx) in vendors"
                  :key="v.id"
                >
                  <td>{{ Number(idx) + 1 }}</td>
                  <td>
                    <input
                      v-model="v.name"
                      class="table-input"
                      type="text"
                      @blur="handleVendorBlur(v)"
                    />
                  </td>
                  <td>
                    <input
                      v-model="v.phone"
                      class="table-input"
                      type="text"
                      @blur="handleVendorBlur(v)"
                    />
                  </td>
                  <td>
                    <input
                      v-model="v.note"
                      class="table-input"
                      type="text"
                      @blur="handleVendorBlur(v)"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-default btn-xs"
                      @click="handleToggleVendorHidden(v)"
                    >
                      {{ v.isHidden ? 'Hiện' : 'Ẩn' }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger btn-xs"
                      @click="handleDeleteVendor(v.id)"
                    >
                      Xóa
                    </button>
                  </td>
                </tr>

                <!-- Hàng thêm mới -->
                <tr>
                  <td>+</td>
                  <td>
                    <input
                      v-model="newVendor.name"
                      class="table-input"
                      type="text"
                      placeholder="Tên nhà cung cấp mới"
                    />
                  </td>
                  <td>
                    <input
                      v-model="newVendor.phone"
                      class="table-input"
                      type="text"
                      placeholder="SĐT"
                    />
                  </td>
                  <td>
                    <input
                      v-model="newVendor.note"
                      class="table-input"
                      type="text"
                      placeholder="Ghi chú"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-primary btn-xs"
                      @click="handleAddVendor"
                    >
                      Thêm
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Card con: Giá nhập hàng -->
        <section class="card vendors-subcard">
          <h4 class="vendors-subcard-title">
            Giá nhập hàng
          </h4>
          <div class="products-table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th style="width: 50px;">STT</th>
                  <th>Tên hàng</th>
                  <th style="width: 100px;">Hình ảnh</th>
                  <th style="width: 120px;">Tồn kho tối thiểu</th>
                  <th style="width: 120px;">Tồn kho tối đa</th>
                  <th
                    v-for="v in vendors.filter(v => !v.isHidden)"
                    :key="v.id"
                  >
                    {{ v.name || (`NCC #${v.id}`) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, idx) in productsWithRows"
                  :key="item.product.id"
                >
                  <td>{{ Number(idx) + 1 }}</td>
                  <td>{{ item.product.name || `Mã ${item.product.id}` }}</td>
                  <td>
                    <div class="product-thumb">
                      <img
                        v-if="item.product.image"
                        :key="'pv-' + item.product.id + '-' + (blobImageVersions[String(item.product.id)] ?? 0)"
                        :src="productImageUrl(item.product)"
                        :alt="item.product.name"
                      />
                      <span v-else>Không có ảnh</span>
                    </div>
                  </td>
                  <td class="text-right">
                    {{ item.product.minStock ?? 0 }}
                  </td>
                  <td class="text-right">
                    {{ item.product.maxStock ?? 0 }}
                  </td>
                  <td
                    v-for="v in vendors.filter(v => !v.isHidden)"
                    :key="v.id"
                    class="text-right"
                  >
                    <input
                      class="number-input"
                      type="text"
                      inputmode="text"
                      :value="formatVendorPriceDisplay(getVendorPrice(item.product.id, v.id))"
                      @input="
                        setVendorPrice(
                          item.product.id,
                          v.id,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>

    <section class="card" style="padding: 8px 10px;">
      <div
        class="replenishment-card-header"
        @click="toggleReplenishmentCollapsed"
      >
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 14px;">Gợi ý nhập hàng</h3>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          @click.stop="toggleReplenishmentCollapsed"
        >
          {{ isReplenishmentCollapsed ? 'Mở' : 'Thu gọn' }}
        </button>
      </div>

      <div v-if="!isReplenishmentCollapsed && replenishmentError" class="text-muted" style="margin-top: 6px; font-size: 13px;">
        Không tải được gợi ý: {{ replenishmentError }}
      </div>

      <div v-else-if="!isReplenishmentCollapsed && !replenishment?.vendorOrders?.length" class="text-muted" style="margin-top: 6px; font-size: 13px;">
        Chưa có gợi ý nhập hàng (có thể do thiếu dữ liệu bán/giá NCC hoặc các sản phẩm đều max_stock = 0).
      </div>

      <div v-else-if="!isReplenishmentCollapsed" class="products-table-wrapper" style="margin-top: 8px;">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 90px;" class="text-center">Khẩn cấp</th>
              <th>Nhà cung cấp</th>
              <th style="width: 140px;">SĐT</th>
              <th style="width: 140px;" class="text-center">Nội dung đặt hàng</th>
              <th>Chi tiết đơn hàng đề xuất</th>
              <th style="width: 140px;" class="text-right">Thời gian giao</th>
              <th style="width: 120px;" class="text-right">Tổng thùng</th>
              <th style="width: 160px;" class="text-right">Tổng tiền</th>
              <th style="width: 120px;">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in (replenishment?.vendorOrders ?? [])" :key="o.vendorId">
              <td class="text-center">
                {{ isEmergencyOrder(o) ? '✔' : '' }}
              </td>
              <td>
                <div style="font-weight: 600;">
                  {{ o.vendorName || (`NCC #${o.vendorId}`) }}
                </div>
                <div v-if="!o.meetsMinOrder" class="text-muted" style="font-size: 12px;">
                  Chưa đạt tối thiểu 5 thùng/đơn (vẫn hiển thị để bạn cân nhắc)
                </div>
              </td>
              <td style="font-size: 13px;">
                <div class="phone-cell">
                  <span>{{ formatPhoneDots(o.vendorPhone) }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs phone-copy-btn"
                    title="Copy SĐT và mở Zalo"
                    @click.stop="copyPhoneAndOpenZalo(o.vendorPhone)"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M8 7C8 5.89543 8.89543 5 10 5H18C19.1046 5 20 5.89543 20 7V15C20 16.1046 19.1046 17 18 17H10C8.89543 17 8 16.1046 8 15V7Z"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linejoin="round"
                      />
                      <path
                        d="M6 19H16"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                      <path
                        d="M4 9V17C4 18.1046 4.89543 19 6 19"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </td>
              <td class="text-center">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs order-msg-copy-btn"
                  title="Copy nội dung đặt hàng"
                  @click.stop="copyOrderMessage(o)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M8 7C8 5.89543 8.89543 5 10 5H18C19.1046 5 20 5.89543 20 7V15C20 16.1046 19.1046 17 18 17H10C8.89543 17 8 16.1046 8 15V7Z"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M6 19H16"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                    <path
                      d="M4 9V17C4 18.1046 4.89543 19 6 19"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </td>
              <td style="font-size: 13px;">
                <div
                  v-for="line in o.lines"
                  :key="line.productId"
                  style="line-height: 1.35;"
                >
                  <span>
                    {{ line.productName || (`Mã ${line.productId}`) }} * {{ line.cases }} (thùng)
                  </span>
                  <span
                    v-if="line.currentStockUnits === 0 || line.currentStockUnits < line.minStockUnits"
                    class="text-muted"
                  >
                    (Stock = {{ line.currentStockUnits }} chai)
                  </span>
                </div>
              </td>
              <td class="text-right">{{ o.leadTimeDays }} ngày</td>
              <td class="text-right">{{ o.totalCases }}</td>
              <td class="text-right">{{ displayMoney(o.totalCost) }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  @click="applyVendorSuggestion(o)"
                >
                  Áp dụng
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="purchase-layout">
  <section :class="['card', { 'card-disabled': saving }]" class="purchase-card">
    <div class="purchase-card-header-row">
      <h3 class="purchase-card-header" style="margin: 0 0 8px 0; font-size: 14px;">Nhập hàng</h3>
      <div class="purchase-vendor-select">
        <label style="font-size: 12px; color: #6b7280; margin-right: 4px;">
          Nhà cung cấp:
        </label>
        <select
          v-model="selectedVendorId"
          class="select-input"
        >
          <option :value="null">
            Chọn nhà cung cấp
          </option>
          <option
            v-for="v in vendors.filter(v => !v.isHidden)"
            :key="v.id"
            :value="v.id"
          >
            {{ v.name || (`NCC #${v.id}`) }}
          </option>
        </select>
      </div>
    </div>
    <div class="purchase-table-scroll">
        <table class="table purchase-table">
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
            <tr
              v-for="(item, idx) in visiblePurchaseRows"
              :key="item.product.id"
            >
              <td>{{ Number(idx) + 1 }}</td>
              <td>{{ item.product.name || `Mã ${item.product.id}` }}</td>
              <td>
                <div class="product-thumb">
                  <img
                    v-if="item.product.image"
                    :key="'p-' + item.product.id + '-' + (blobImageVersions[String(item.product.id)] ?? 0)"
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

    <div class="purchase-card-footer">
        <div>
          <div style="font-size: 13px; color: #6b7280;">Tổng tiền hàng</div>
          <div style="font-size: 18px; font-weight: 600;">
            {{ displayMoney(totalAmount) }} đ
          </div>
        </div>
        <button
          type="button"
          class="btn btn-primary"
          :class="{ disabled: !totalAmount || !selectedVendorId || saving }"
          :disabled="!totalAmount || !selectedVendorId || saving"
          @click="handleImport"
        >
          {{ saving ? 'Đang lưu...' : 'Nhập hàng' }}
        </button>
    </div>
  </section>

  <section :class="['card', { 'card-disabled': saving }]" class="purchase-history-card">
    <h3 style="margin: 0 0 8px 0; font-size: 14px;">Lịch sử nhập hàng</h3>
    <div class="products-table-wrapper">
      <table class="table">
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 130px;">Thời gian</th>
              <th style="width: 160px;">Nhà cung cấp</th>
              <th style="width: 260px;">Đơn hàng nhập</th>
              <th style="width: 260px;">Tổng tiền hàng</th>
              <th style="width: 90px;">Thao tác</th>
            </tr>
          </thead>
        <tbody>
          <tr v-for="entry in importsNewestFirst" :key="entry.id">
            <td>{{ entry.id }}</td>
            <td style="font-size: 13px;">
              <div>
                {{ formatImportTimestamp(entry.timestamp).split(' ')[0] }}
              </div>
              <div>
                {{ formatImportTimestamp(entry.timestamp).split(' ')[1] }}
              </div>
            </td>
            <td>{{ findVendorNameById(entry.vendorId as number | null | undefined) }}</td>
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
          <tr v-if="!importsNewestFirst.length">
            <td colspan="5" class="text-muted" style="font-size: 13px;">
              Chưa có lịch sử nhập hàng trong phiên hiện tại.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  </div>
  </div>
</template>

<style scoped>
.purchase-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.replenishment-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.phone-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.phone-copy-btn {
  padding: 0 4px;
  line-height: 1;
}

.order-msg-copy-btn {
  padding: 0 6px;
  line-height: 1;
}

.vendors-card {
  padding: 8px 10px;
}

.vendors-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.vendors-card-title {
  margin: 0;
  font-size: 14px;
}

.vendors-card-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vendors-subcard {
  padding: 8px 10px;
}

.vendors-subcard-title {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
}

.table-input {
  width: 100%;
  padding: 2px 4px;
  font-size: 13px;
}

.select-input {
  width: 100%;
  padding: 2px 4px;
  font-size: 13px;
}

.purchase-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.purchase-card {
  flex: 1;
  min-width: 0;
  max-height: calc(100vh - 145px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.purchase-card-header {
  flex-shrink: 0;
  margin-bottom: 8px;
}

.purchase-card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 8px;
  gap: 8px;
}

.purchase-vendor-select {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.purchase-vendor-select label {
  white-space: nowrap;
}
.purchase-table-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 12px;
}
.purchase-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: white;
  box-shadow: 0 1px 0 #e5e7eb;
}
.purchase-card-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.purchase-history-card {
  flex: 1;
  min-width: 0;
  max-height: calc(100vh - 145px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.purchase-history-card .products-table-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .purchase-layout {
    flex-direction: column;
    gap: 8px;
  }

  .purchase-card,
  .purchase-history-card {
    max-height: none;
  }
}
</style>

