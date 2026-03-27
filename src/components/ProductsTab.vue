<script setup lang="ts">
import { computed, reactive, ref, nextTick } from 'vue'
import type { Product } from '~/composables/usePosStore'

const { data, products, saveProductsOnly, lastImportCostPerUnitByProductId } = usePosStore()
const { apiFetch, getApiUrl } = useApiOrigin()
const saving = ref(false)
const showDetails = ref(false)
/** Cache-buster cho ảnh blob khi upload đè: thay đổi URL để trình duyệt/CDN không dùng ảnh cũ. */
const blobImageVersions = useState<Record<string, number>>('pos-blob-image-versions', () => ({}))
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Lưu nền (không bật overlay/cursor loading toàn màn hình). */
function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
    saveTimer = setTimeout(async () => {
      saving.value = true
      try {
        await saveProductsOnly()
      } catch (err) {
      console.error(err)
    } finally {
      saving.value = false
      saveTimer = null
    }
  }, 500)
}

const visibleProducts = computed(() =>
  products.value.filter((p) => !p.isHidden)
)

const hiddenProducts = computed(() =>
  products.value.filter((p) => p.isHidden)
)

const showSelling = ref(true)
const displayedProducts = computed(() =>
  showSelling.value ? visibleProducts.value : hiddenProducts.value
)

type ImageTarget =
  | { type: 'product'; product: Product }
  | { type: 'new'; index: number }

const fileInputRef = ref<HTMLInputElement | null>(null)
const imageDialogTarget = ref<ImageTarget | null>(null)
const imageDialogUrl = ref('')
const imageDialogFile = ref<File | null>(null)
const showImageDialog = ref(false)

type NewProductRow = {
  name: string
  image: string
  price: number | null
  stock: number
  packSize: number
  isHidden: boolean
}

function createEmptyNewRow(): NewProductRow {
  return {
    name: '',
    image: '',
    price: null,
    stock: 0,
    packSize: 24,
    isHidden: false
  }
}

const newProducts = reactive<NewProductRow[]>([
  createEmptyNewRow(),
  createEmptyNewRow(),
  createEmptyNewRow(),
  createEmptyNewRow(),
  createEmptyNewRow()
])

const canAddAny = computed(() =>
  newProducts.some((r) => (r.name || '').trim() !== '')
)

function onNewRowPriceChange(index: number, value: string) {
  const normalized = value.replace(/[^0-9]/g, '')
  newProducts[index].price = normalized === '' ? null : (isNaN(Number(normalized)) ? null : Number(normalized))
}

function formatMoneyInput(v: number) {
  if (!v) return ''
  return v.toLocaleString('vi-VN')
}

function onNameChange(p: Product, value: string) {
  p.name = value
  scheduleSave()
}

function onNumberChange(
  p: Product,
  field: 'price' | 'packSize',
  value: string
) {
  const normalized = value.replace(/[^0-9]/g, '')
  const num = Number(normalized || '0')
  ;(p as any)[field] = isNaN(num) ? 0 : num
  scheduleSave()
}

function onDecimalChange(
  p: Product,
  field: 'minStock' | 'maxStock',
  value: string
) {
  // Cho phép số thập phân (0.5, 0.25, ...)
  const normalized = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
  const num = parseFloat(normalized || '0')
  ;(p as any)[field] = isNaN(num) ? 0 : num
  scheduleSave()
}

const sellingTableColspan = computed(() => (showDetails.value ? 10 : 6))

const MAX_IMAGE_PX = 432

/** Resize ảnh max 432×432 (giữ tỉ lệ), trả về data URL PNG; thất bại thì trả về null. */
function resizeImageToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) {
        resolve(null)
        return
      }
      const scale = Math.min(MAX_IMAGE_PX / w, MAX_IMAGE_PX / h, 1)
      const cw = Math.round(w * scale)
      const ch = Math.round(h * scale)
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, cw, ch)
      const dataUrl = canvas.toDataURL('image/png')
      resolve(dataUrl)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

function buildImageFileName(baseName: string, ext: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = now.getFullYear()
  const mm = pad(now.getMonth() + 1)
  const dd = pad(now.getDate())
  const hh = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  const dateTime = `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
  return `${baseName}_${dateTime}${ext}`
}

async function uploadImageFromDataUrl(dataUrl: string, baseName: string): Promise<string> {
  const ext = dataUrl.startsWith('data:image/jpeg') ? '.jpg' : '.png'
  const fileName = buildImageFileName(baseName, ext)
  return await uploadImage(dataUrl, fileName)
}

async function createDataUrlFromFile(file: File): Promise<string | null> {
  let dataUrl = await resizeImageToDataUrl(file)
  if (!dataUrl) {
    dataUrl = await readFileAsDataUrl(file)
  }
  return dataUrl
}

async function uploadImageFromUrl(rawUrl: string, baseName: string): Promise<string | null> {
  const url = rawUrl.trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) {
    alert('Vui lòng nhập URL ảnh hợp lệ (bắt đầu bằng http hoặc https).')
    return null
  }
  try {
    const res = await fetch(url)
    if (!res.ok) {
      alert('Không tải được ảnh từ URL này.')
      return null
    }
    const blob = await res.blob()
    const guessedType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png'
    const file = new File([blob], 'image-from-url', { type: guessedType })
    const dataUrl = await createDataUrlFromFile(file)
    if (!dataUrl) {
      alert('Không đọc được dữ liệu ảnh từ URL này.')
      return null
    }
    return await uploadImageFromDataUrl(dataUrl, baseName)
  } catch (err: any) {
    alert(err?.message || 'Không tải được ảnh từ URL.')
    return null
  }
}

async function uploadImage(dataUrl: string, fileName: string): Promise<string> {
  const res = await apiFetch<{ fileName: string; url?: string }>('/api/upload-image', {
    method: 'POST',
    body: { fileName, dataUrl }
  })
  return res.url ?? res.fileName
}

function handleDrop(e: DragEvent, product: Product) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return

  const baseName = product.name ? `${product.name}` : `product-${product.id}`

  createDataUrlFromFile(file).then(async (dataUrl) => {
    if (!dataUrl) return
    try {
      const url = await uploadImageFromDataUrl(dataUrl, baseName)
      product.image = url
      blobImageVersions.value[String(product.id)] = Date.now()
      scheduleSave()
    } catch (err: any) {
      alert(err?.data?.statusMessage || err?.message || 'Upload ảnh thất bại.')
    }
  })
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = reader.result as string
      resolve(s?.startsWith('data:') ? s : null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  const target = e.currentTarget as HTMLElement
  target.classList.add('drag-over')
}

function handleDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement
  target.classList.remove('drag-over')
}

function handleDropNewProduct(e: DragEvent, index: number) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  const row = newProducts[index]
  const baseName = row.name?.trim() || `new-product-${index + 1}`

  createDataUrlFromFile(file).then(async (dataUrl) => {
    if (!dataUrl) return
    try {
      const url = await uploadImageFromDataUrl(dataUrl, baseName)
      row.image = url
      blobImageVersions.value['new-' + index] = Date.now()
    } catch (err: any) {
      alert(err?.data?.statusMessage || err?.message || 'Upload ảnh thất bại.')
    }
  })
}

async function handleClickDropZoneForProduct(product: Product) {
  imageDialogTarget.value = { type: 'product', product }
  imageDialogUrl.value = ''
  imageDialogFile.value = null
  showImageDialog.value = true
}

async function handleClickDropZoneForNew(index: number) {
  imageDialogTarget.value = { type: 'new', index }
  imageDialogUrl.value = ''
  imageDialogFile.value = null
  showImageDialog.value = true
}

async function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  imageDialogFile.value = file
}

function closeImageDialog() {
  showImageDialog.value = false
  imageDialogTarget.value = null
  imageDialogUrl.value = ''
  imageDialogFile.value = null
}

function triggerChooseImageFromMachine() {
  nextTick(() => {
    fileInputRef.value?.click()
  })
}

async function confirmImageDialog() {
  const target = imageDialogTarget.value
  if (!target) {
    closeImageDialog()
    return
  }
  const hasUrl = !!imageDialogUrl.value.trim()
  const hasFile = !!imageDialogFile.value
  if (!hasUrl && !hasFile) return

  try {
    if (target.type === 'product') {
      const baseName = target.product.name ? `${target.product.name}` : `product-${target.product.id}`
      let url: string | null = null
      if (hasUrl) {
        url = await uploadImageFromUrl(imageDialogUrl.value, baseName)
      } else if (imageDialogFile.value) {
        const dataUrl = await createDataUrlFromFile(imageDialogFile.value)
        if (!dataUrl) return
        url = await uploadImageFromDataUrl(dataUrl, baseName)
      }
      if (!url) return
      target.product.image = url
      blobImageVersions.value[String(target.product.id)] = Date.now()
      scheduleSave()
    } else if (target.type === 'new') {
      const row = newProducts[target.index]
      const baseName = row.name?.trim() || `new-product-${target.index + 1}`
      let url: string | null = null
      if (hasUrl) {
        url = await uploadImageFromUrl(imageDialogUrl.value, baseName)
      } else if (imageDialogFile.value) {
        const dataUrl = await createDataUrlFromFile(imageDialogFile.value)
        if (!dataUrl) return
        url = await uploadImageFromDataUrl(dataUrl, baseName)
      }
      if (!url) return
      row.image = url
      blobImageVersions.value['new-' + target.index] = Date.now()
    }
  } finally {
    closeImageDialog()
  }
}

function productImageUrl(product: Product) {
  if (!product.image) return ''
  if (product.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(product.id)] ?? 0
    return getApiUrl(`/api/blob-image?url=${encodeURIComponent(product.image)}&_t=${t}`)
  }
  return product.image.startsWith('http') ? product.image : ''
}

function imageUrl(img: string, versionKey?: string | number) {
  if (!img) return ''
  if (img.includes('private.blob.vercel-storage.com')) {
    const t = versionKey != null ? (blobImageVersions.value[String(versionKey)] ?? 0) : 0
    return getApiUrl(`/api/blob-image?url=${encodeURIComponent(img)}&_t=${t}`)
  }
  return img.startsWith('http') ? img : ''
}

function hideProduct(p: Product) {
  p.isHidden = true
  scheduleSave()
}

function showProduct(p: Product) {
  p.isHidden = false
  scheduleSave()
}

function addAllNewProducts() {
  if (!canAddAny.value) return

  const list = data.value.products
  let nextId = list.length ? Math.max(...list.map((p) => p.id)) + 1 : 1

  for (const row of newProducts) {
    const name = (row.name || '').trim()
    if (name === '' || row.price == null || isNaN(row.price)) continue
    list.push({
      id: nextId++,
      name,
      image: row.image,
      price: Number(row.price) || 0,
      stock: Number(row.stock) || 0,
      packSize: Number(row.packSize) || 24,
      isHidden: false
    })
  }

  for (let i = 0; i < newProducts.length; i++) {
    Object.assign(newProducts[i], createEmptyNewRow())
  }

  scheduleSave()
}
</script>

<template>
  <div class="products-layout">
  <section class="card card-selling">
    <div class="report-toolbar" style="margin-bottom: 8px;">
      <span style="font-size: 13px;">Sản phẩm</span>
      <div class="products-toolbar-right">
        <div class="report-toggle-group">
          <button
            type="button"
            class="report-toggle-btn"
            :class="{ active: showSelling }"
            @click="showSelling = true"
          >
            Đang bán
          </button>
          <button
            type="button"
            class="report-toggle-btn"
            :class="{ active: !showSelling }"
            @click="showSelling = false"
          >
            Đã ẩn
          </button>
        </div>
        <button
          type="button"
          class="btn btn-default btn-s"
          :class="{ active: showDetails }"
          @click="showDetails = !showDetails"
          title="Bật để hiển thị: Giá vốn, Tồn kho tối thiểu/tối đa (thùng), SL/thùng"
        >
          Hiển thị chi tiết
        </button>
      </div>
    </div>
    <div class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th class="col-name">Tên hàng</th>
            <th style="width: 120px;" class="text-center">Hình ảnh</th>
            <th style="width: 110px;" class="text-center col-price">Giá bán</th>
            <th v-if="showDetails" style="width: 80px;" class="text-center">Giá vốn</th>
            <th style="width: 100px;" class="text-center">Tồn kho (chai)</th>
            <th v-if="showDetails" style="width: 135px;" class="text-center">Tồn kho tối thiểu (thùng)</th>
            <th v-if="showDetails" style="width: 135px;" class="text-center">Tồn kho tối đa (thùng)</th>
            <th v-if="showDetails" style="width: 90px;" class="text-center">SL/thùng</th>
            <th style="width: 80px;" class="text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in displayedProducts" :key="p.id">
            <td>{{ p.displayOrder ?? p.id }}</td>
            <td class="col-name">
              <input
                class="field-input"
                type="text"
                :value="p.name"
                @input="onNameChange(p, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <div
                class="drop-zone"
                @dragover="handleDragOver"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, p)"
                @click="handleClickDropZoneForProduct(p)"
              >
                <div v-if="p.image">
                  <img
                    :key="'p-' + p.id + '-' + (blobImageVersions[String(p.id)] ?? 0)"
                    :src="productImageUrl(p)"
                    :alt="p.name"
                    style="width: 54px; height: 54px; object-fit: cover; border-radius: 6px;"
                  />
                </div>
                <div v-else>
                  Kéo & thả ảnh vào đây
                </div>
              </div>
            </td>
            <td class="col-price">
              <input
                class="number-input"
                type="text"
                inputmode="numeric"
                :value="formatMoneyInput(p.price)"
                @input="onNumberChange(p, 'price', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td v-if="showDetails" class="text-right text-muted" style="font-variant-numeric: tabular-nums;">
              {{ formatMoneyInput(lastImportCostPerUnitByProductId[p.id] ?? 0) }}
            </td>
            <td class="text-center text-muted" style="font-variant-numeric: tabular-nums;">
              {{ p.stock }}
            </td>
            <td v-if="showDetails">
              <input
                class="number-input"
                type="number"
                step="0.25"
                min="0"
                :value="p.minStock ?? 0"
                @input="onDecimalChange(p, 'minStock', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td v-if="showDetails">
              <input
                class="number-input"
                type="number"
                step="0.25"
                min="0"
                :value="p.maxStock ?? 0"
                @input="onDecimalChange(p, 'maxStock', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td v-if="showDetails">
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                :value="p.packSize ?? 24"
                @input="onNumberChange(p, 'packSize', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="text-center">
              <button
                v-if="showSelling"
                type="button"
                class="btn btn-default btn-m"
                @click="hideProduct(p)"
              >
                Ẩn
              </button>
              <button
                v-else
                type="button"
                class="btn btn-default btn-m"
                @click="showProduct(p)"
              >
                Hiện
              </button>
            </td>
          </tr>
          <tr v-if="!showSelling && !displayedProducts.length">
            <td :colspan="sellingTableColspan" class="text-muted" style="font-size: 13px;">
              Không có sản phẩm nào bị ẩn.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="products-right">
    <section class="card card-add-new">
      <div class="card-add-new-header">
        <h3 style="margin: 0; font-size: 14px;">Thêm sản phẩm mới</h3>
        <button
          type="button"
          class="btn btn-primary btn-s"
          :disabled="!canAddAny"
          @click="addAllNewProducts"
        >
          Thêm
        </button>
      </div>
      <div class="add-new-table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 50px;">STT</th>
              <th>Tên hàng</th>
              <th style="width: 80px;" class="text-center">SL/thùng</th>
              <th style="width: 120px;" class="text-center">Hình ảnh</th>
              <th style="width: 110px;" class="text-center">Giá bán</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in newProducts" :key="index">
              <td>{{ index + 1 }}</td>
              <td>
                <input
                  class="field-input"
                  type="text"
                  v-model="row.name"
                  placeholder="Tên sản phẩm mới"
                />
              </td>
              <td>
                <input
                  class="number-input"
                  type="number"
                  step="1"
                  min="0"
                  v-model.number="row.packSize"
                />
              </td>
              <td>
                <div
                  class="drop-zone"
                  @dragover="handleDragOver"
                  @dragleave="handleDragLeave"
                  @drop="handleDropNewProduct($event, index)"
                  @click="handleClickDropZoneForNew(index)"
                >
                  <div v-if="row.image">
                    <img
                      :key="'new-' + index + '-' + (blobImageVersions['new-' + index] ?? 0)"
                      :src="imageUrl(row.image, 'new-' + index)"
                      alt=""
                      style="width: 54px; height: 54px; object-fit: cover; border-radius: 6px;"
                    />
                  </div>
                  <div v-else>
                    Kéo & thả ảnh vào đây, hoặc click để tải ảnh lên
                  </div>
                </div>
              </td>
              <td>
                <input
                  class="number-input"
                  type="text"
                  inputmode="numeric"
                  :value="row.price === null ? '' : row.price"
                  placeholder=""
                  @input="onNewRowPriceChange(index, ($event.target as HTMLInputElement).value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  </div>
  <input
    ref="fileInputRef"
    type="file"
    accept="image/*"
    style="display: none;"
    @change="handleFileInputChange"
  />
  <div v-if="showImageDialog" class="image-dialog-backdrop" @click.self="closeImageDialog">
    <div class="image-dialog">
      <h3 class="image-dialog-title">Chọn ảnh sản phẩm</h3>
      <label class="image-dialog-label">
        Link ảnh
        <input
          v-model="imageDialogUrl"
          type="text"
          placeholder="Dán link ảnh (http/https)..."
          class="field-input image-dialog-input"
        />
      </label>
      <div class="image-dialog-actions-row">
        <button type="button" class="btn btn-default btn-s" @click="triggerChooseImageFromMachine">
          Chọn ảnh từ máy
        </button>
        <span class="image-dialog-file-name" v-if="imageDialogFile">
          {{ imageDialogFile.name }}
        </span>
        <span class="image-dialog-file-name text-muted" v-else>
          Chưa chọn ảnh từ máy
        </span>
      </div>
      <div class="image-dialog-footer">
        <button type="button" class="btn btn-default btn-s" @click="closeImageDialog">
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary btn-s"
          :disabled="!imageDialogUrl.trim() && !imageDialogFile"
          @click="confirmImageDialog"
        >
          OK
        </button>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
.products-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.products-layout {
  display: grid;
  grid-template-columns: 65fr 35fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 900px) {
  .products-layout {
    grid-template-columns: 1fr;
  }
}
.products-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-add-new-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
}
.card-add-new-header .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.card-add-new .add-new-table-wrapper {
  overflow: hidden;
}
.card-selling {
  display: flex;
  flex-direction: column;
}
.card-selling .products-table-wrapper {
  overflow: auto;
  min-height: 0;
}

@media (max-width: 1024px) {
  .products-layout {
    gap: 8px;
  }

  /* Nới rộng Tên hàng + Giá bán, table cho phép tràn ngang để vuốt */
  .card-selling .table {
    width: auto;
    min-width: 720px;
  }

  .card-selling .table th.col-name,
  .card-selling .table td.col-name {
    min-width: 260px !important;
  }

  .card-selling .table th.col-price,
  .card-selling .table td.col-price {
    min-width: 140px !important;
  }
}

/* Mobile: thu hẹp Tên hàng (-25%) và Giá bán (-50%) */
@media (max-width: 640px) {
  .card-selling .table th.col-name,
  .card-selling .table td.col-name {
    min-width: 195px !important; /* 260px * 0.75 */
  }

  .card-selling .table th.col-price,
  .card-selling .table td.col-price {
    min-width: 70px !important; /* 140px * 0.5 */
  }
}

.image-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.image-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  padding: 16px 18px 14px;
  width: min(420px, 90vw);
}

.image-dialog-title {
  margin: 0 0 10px;
  font-size: 15px;
}

.image-dialog-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  margin-bottom: 10px;
}

.image-dialog-input {
  width: 100%;
}

.image-dialog-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 12px;
}

.image-dialog-file-name {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
