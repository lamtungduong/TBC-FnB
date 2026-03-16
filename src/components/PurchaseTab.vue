<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
const { getApiUrl } = useApiOrigin()

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
                  <td>{{ idx + 1 }}</td>
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
                  <td>{{ idx + 1 }}</td>
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
              <td>{{ idx + 1 }}</td>
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
          :class="{ disabled: !totalAmount || saving }"
          :disabled="!totalAmount || saving"
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

