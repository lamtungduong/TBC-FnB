<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Product } from '~/composables/usePosStore'

const { data, products, saveProducts } = usePosStore()
const saving = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(async () => {
    saving.value = true
    try {
      await saveProducts()
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

const newProduct = reactive<Omit<Product, 'id'>>({
  name: '',
  image: '',
  price: 0,
  cost: 0,
  stock: 0,
  packSize: 24,
  isHidden: false
} as Omit<Product, 'id'>)

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

function handleDrop(e: DragEvent, product: Product) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = (reader.result as string) || ''
    if (!base64.startsWith('data:')) return

    const fileName = product.name ? `${product.name}.png` : `product-${product.id}.png`

    const res = await $fetch<{ fileName: string }>('/api/upload-image', {
      method: 'POST',
      body: {
        fileName,
        dataUrl: base64
      }
    })

    product.image = res.fileName
    scheduleSave()
  }
  reader.readAsDataURL(file)
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

function productImageUrl(product: Product) {
  if (!product.image) return ''
  return `/images/${product.image}`
}

function hideProduct(p: Product) {
  p.isHidden = true
  scheduleSave()
}

function showProduct(p: Product) {
  p.isHidden = false
  scheduleSave()
}

function addNewProduct() {
  if (!newProduct.name || !newProduct.name.trim()) return

  const list = data.value.products
  const nextId = list.length ? Math.max(...list.map((p) => p.id)) + 1 : 1

  list.push({
    id: nextId,
    name: newProduct.name.trim(),
    image: newProduct.image,
    price: Number(newProduct.price) || 0,
    cost: Number(newProduct.cost) || 0,
    stock: Number(newProduct.stock) || 0,
    packSize: Number(newProduct.packSize) || 24,
    isHidden: false
  })

  newProduct.name = ''
  newProduct.image = ''
  newProduct.price = 0
  newProduct.cost = 0
  newProduct.stock = 0
  newProduct.packSize = 24

  scheduleSave()
}
</script>

<template>
  <section class="card">
    <div style="margin-bottom: 8px;">
      <h3 style="margin: 0; font-size: 14px;">Sản phẩm đang bán</h3>
    </div>

    <div class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th>Tên hàng</th>
            <th style="width: 90px;" class="text-right">SL/thùng</th>
            <th style="width: 120px;">Hình ảnh</th>
            <th style="width: 110px;" class="text-right">Giá bán</th>
            <th style="width: 110px;" class="text-right">Giá vốn</th>
            <th style="width: 110px;" class="text-right">Tồn kho</th>
            <th style="width: 80px;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in visibleProducts" :key="p.id">
            <td>{{ p.id }}</td>
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
            <td>
              <input
                class="number-input"
                type="text"
                inputmode="numeric"
                :value="formatMoneyInput(p.cost)"
                @input="onNumberChange(p, 'cost', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                :value="p.stock"
                @input="onNumberChange(p, 'stock', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <button type="button" class="btn btn-ghost btn-xs" @click="hideProduct(p)">
                Ẩn
              </button>
            </td>
          </tr>
          <tr>
            <td>+</td>
            <td>
              <input
                class="field-input"
                type="text"
                v-model="newProduct.name"
                placeholder="Tên sản phẩm mới"
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                v-model.number="newProduct.packSize"
              />
            </td>
            <td>
              <span class="text-muted" style="font-size: 12px;">Thêm hình sau</span>
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                v-model.number="newProduct.price"
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                v-model.number="newProduct.cost"
                disabled
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                v-model.number="newProduct.stock"
                disabled
              />
            </td>
            <td>
              <button type="button" class="btn btn-primary btn-xs" @click="addNewProduct">
                Thêm
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-top: 16px;">
    <div
      style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
    >
      <h3 style="margin: 0; font-size: 14px;">Sản phẩm đã ẩn</h3>
    </div>

    <div class="products-table-wrapper">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 50px;">STT</th>
            <th>Tên hàng</th>
            <th style="width: 90px;" class="text-right">SL/thùng</th>
            <th style="width: 120px;">Hình ảnh</th>
            <th style="width: 110px;" class="text-right">Giá bán</th>
            <th style="width: 110px;" class="text-right">Giá vốn</th>
            <th style="width: 110px;" class="text-right">Tồn kho</th>
            <th style="width: 80px;">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in hiddenProducts" :key="p.id">
            <td>{{ p.id }}</td>
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
                    :src="productImageUrl(p)"
                    :alt="p.name"
                    style="width: 54px; height: 54px; object-fit: cover; border-radius: 6px;"
                  />
                  <div class="mt-2" style="font-size: 10px; color: #6b7280;">
                    {{ p.image }}
                  </div>
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
            <td>
              <input
                class="number-input"
                type="text"
                inputmode="numeric"
                :value="formatMoneyInput(p.cost)"
                @input="onNumberChange(p, 'cost', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <input
                class="number-input"
                type="number"
                step="1"
                min="0"
                :value="p.stock"
                @input="onNumberChange(p, 'stock', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <button type="button" class="btn btn-ghost btn-xs" @click="showProduct(p)">
                Hiện
              </button>
            </td>
          </tr>
          <tr v-if="!hiddenProducts.length">
            <td colspan="7" class="text-muted" style="font-size: 13px;">
              Không có sản phẩm nào bị ẩn.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

