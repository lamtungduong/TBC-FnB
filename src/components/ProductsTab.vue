<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Product } from '~/composables/usePosStore'

const { data, products, saveData, lastImportCostPerUnitByProductId } = usePosStore()
const saving = ref(false)
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
      await saveData()
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


type NewProductRow = {
  name: string
  image: string
  price: number | null
  cost: number
  stock: number
  packSize: number
  isHidden: boolean
}

function createEmptyNewRow(): NewProductRow {
  return {
    name: '',
    image: '',
    price: null,
    cost: 0,
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
  field: 'price' | 'cost' | 'stock' | 'packSize',
  value: string
) {
  const normalized = value.replace(/[^0-9]/g, '')
  const num = Number(normalized || '0')
  ;(p as any)[field] = isNaN(num) ? 0 : num
  scheduleSave()
}

const MAX_IMAGE_PX = 54

/** Resize ảnh max 54×54 (giữ tỉ lệ), trả về data URL JPEG để nhẹ; thất bại thì trả về null. */
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

async function uploadImage(dataUrl: string, fileName: string): Promise<string> {
  const res = await $fetch<{ fileName: string; url?: string }>('/api/upload-image', {
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

  resizeImageToDataUrl(file).then(async (dataUrl) => {
    let urlToUse: string | null = dataUrl
    if (!urlToUse) urlToUse = await readFileAsDataUrl(file)
    if (!urlToUse) return
    const ext = urlToUse.startsWith('data:image/jpeg') ? '.jpg' : '.png'
    const fileName = `${baseName}${ext}`
    try {
      const url = await uploadImage(urlToUse, fileName)
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

  resizeImageToDataUrl(file).then(async (dataUrl) => {
    let urlToUse: string | null = dataUrl
    if (!urlToUse) urlToUse = await readFileAsDataUrl(file)
    if (!urlToUse) return
    const ext = urlToUse.startsWith('data:image/jpeg') ? '.jpg' : '.png'
    const fileName = `${baseName}${ext}`
    try {
      const url = await uploadImage(urlToUse, fileName)
      row.image = url
      blobImageVersions.value['new-' + index] = Date.now()
    } catch (err: any) {
      alert(err?.data?.statusMessage || err?.message || 'Upload ảnh thất bại.')
    }
  })
}

function productImageUrl(product: Product) {
  if (!product.image) return ''
  if (product.image.includes('private.blob.vercel-storage.com')) {
    const t = blobImageVersions.value[String(product.id)] ?? 0
    return `/api/blob-image?url=${encodeURIComponent(product.image)}&_t=${t}`
  }
  return product.image.startsWith('http') ? product.image : `/images/${product.image}`
}

function imageUrl(img: string, versionKey?: string | number) {
  if (!img) return ''
  if (img.includes('private.blob.vercel-storage.com')) {
    const t = versionKey != null ? (blobImageVersions.value[String(versionKey)] ?? 0) : 0
    return `/api/blob-image?url=${encodeURIComponent(img)}&_t=${t}`
  }
  return img.startsWith('http') ? img : `/images/${img}`
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
      cost: Number(row.cost) || 0,
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
    </div>
    <div class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th>Tên hàng</th>
            <th style="width: 80px;" class="text-center">SL/thùng</th>
            <th style="width: 120px;" class="text-center">Hình ảnh</th>
            <th style="width: 110px;" class="text-center">Giá bán</th>
            <th style="width: 80px;" class="text-center">Giá vốn</th>
            <th style="width: 80px;" class="text-center">Tồn kho</th>
            <th style="width: 80px;" class="text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in displayedProducts" :key="p.id">
            <td>{{ p.displayOrder ?? p.id }}</td>
            <td>
              <input
                class="field-input"
                type="text"
                :value="p.name"
                @input="onNameChange(p, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                :value="p.packSize ?? 24"
                @input="onNumberChange(p, 'packSize', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <div
                class="drop-zone"
                @dragover="handleDragOver"
                @dragleave="handleDragLeave"
                @drop="handleDrop($event, p)"
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
            <td>
              <input
                class="number-input"
                type="text"
                inputmode="numeric"
                :value="formatMoneyInput(p.price)"
                @input="onNumberChange(p, 'price', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="text-right text-muted" style="font-variant-numeric: tabular-nums;">
              {{ formatMoneyInput(lastImportCostPerUnitByProductId[p.id] ?? p.cost) }}
            </td>
            <td class="text-center text-muted" style="font-variant-numeric: tabular-nums;">
              {{ p.stock }}
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
            <td colspan="8" class="text-muted" style="font-size: 13px;">
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
                    Kéo & thả ảnh vào đây
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
  </div>
</template>

<style scoped>
.products-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
</style>
