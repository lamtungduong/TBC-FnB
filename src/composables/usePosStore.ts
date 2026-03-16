import { computed } from 'vue'
import { parseTimestampAsGMT7 } from '~/utils/date'

/** Thời điểm hiện tại GMT+7, định dạng "YYYY-MM-DD HH:mm:ss". Không phụ thuộc timezone trình duyệt. */
function getNowGMT7(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const gmt7 = new Date(d.getTime() + 7 * 60 * 60000)
  const y = gmt7.getUTCFullYear()
  const m = gmt7.getUTCMonth() + 1
  const day = gmt7.getUTCDate()
  const h = gmt7.getUTCHours()
  const mi = gmt7.getUTCMinutes()
  const s = gmt7.getUTCSeconds()
  return `${y}-${pad(m)}-${pad(day)} ${pad(h)}:${pad(mi)}:${pad(s)}`
}

export type Product = {
  id: number
  name: string
  image: string // relative path trong thư mục "Hình ảnh"
  price: number
  cost: number
  stock: number
  packSize?: number
  isHidden?: boolean
  displayOrder?: number
  minStock?: number
  maxStock?: number
}

export type SaleItem = {
  productId: number
  qty: number
  price: number
  cost: number
}

export type Sale = {
  id: number
  timestamp: string // GMT+7 "YYYY-MM-DD HH:mm:ss"
  items: SaleItem[]
}

export type PosData = {
  products: Product[]
  sales: Sale[]
  imports?: StockImport[]
  vendors?: Vendor[]
  vendorPrices?: {
    product_id: number
    vendor_id: number
    price_per_case: number
  }[]
}

export type ImportItem = {
  productId: number
  cases: number
  pricePerCase: number
  packSize: number
  addedUnits: number
  addedCost: number
}

export type StockImport = {
  id: number
  timestamp: string
  items: ImportItem[]
  vendorId?: number | null
}

export type Vendor = {
  id: number
  name: string
  phone: string
  note: string
}

const EMPTY_DATA: PosData = {
  products: Array.from({ length: 100 }).map((_, idx) => ({
    id: idx + 1,
    name: '',
    image: '',
    price: 0,
    cost: 0,
    stock: 0,
    packSize: 24,
    isHidden: false
  })),
  sales: []
}

// Timer dùng để cập nhật "page load time" realtime cho tab hiện tại
let pageLoadTimer: ReturnType<typeof setInterval> | null = null

export const usePosStore = () => {
  const { apiFetch } = useApiOrigin()
  const data = useState<PosData>('pos-data', () => structuredClone(EMPTY_DATA))
  const isLoaded = useState<boolean>('pos-loaded', () => false)
  const isProcessing = useState<boolean>('pos-processing', () => false)
  /** Thời điểm bắt đầu xử lý (để tính thời gian load). */
  const processingStartTime = useState<number | null>('pos-processing-start', () => null)
  /** Thời gian xử lý lần trước (ms), hiển thị ở header. */
  const lastLoadDurationMs = useState<number | null>('pos-last-load-duration', () => null)
  /** False sau lần load đầu; dùng để không hiện overlay khi web mới load. */
  const isInitialLoad = useState<boolean>('pos-initial-load', () => true)
  /** Đánh dấu đã load từng phần dữ liệu (dùng cho lazy-load theo tab). */
  const hasLoadedProducts = useState<boolean>('pos-has-products', () => false)
  const hasLoadedSales = useState<boolean>('pos-has-sales', () => false)
  const hasLoadedImports = useState<boolean>('pos-has-imports', () => false)
  const hasLoadedVendors = useState<boolean>('pos-has-vendors', () => false)

  const cart = useState<{ productId: number; qty: number }[]>('pos-cart', () => [])
  const noPayment = useState<boolean>('pos-no-payment', () => false)
  const importsState = useState<StockImport[]>('pos-imports', () => [])
  const nextImportId = useState<number>('pos-imports-next-id', () => 1)
  const vendorsState = useState<Vendor[]>('pos-vendors', () => [])
  const vendorPricesState = useState<
    { product_id: number; vendor_id: number; price_per_case: number; updated_at?: string | null }[]
  >('pos-vendor-prices', () => [])

  const products = computed(() => data.value.products)
  const sales = computed(() => data.value.sales)
  const vendors = computed(() => vendorsState.value)
  const vendorPrices = computed(() => vendorPricesState.value)

  const namedProducts = computed(() => {
    const list = data.value.products.filter(
      (p) => p.name && p.name.trim() !== '' && !p.isHidden
    )
    const order = (p: Product) => p.displayOrder ?? p.id
    return [...list].sort((a, b) => order(a) - order(b))
  })

  const cartLines = computed(() => {
    const zeroAmount = noPayment.value
    return cart.value
      .map((line) => {
        const product = data.value.products.find((p) => p.id === line.productId)
        if (!product) return null
        const lineTotal = zeroAmount ? 0 : product.price * line.qty
        return {
          productId: product.id,
          name: product.name,
          price: product.price,
          qty: line.qty,
          lineTotal
        }
      })
      .filter(Boolean) as {
      productId: number
      name: string
      price: number
      qty: number
      lineTotal: number
    }[]
  })

  const cartTotal = computed(() =>
    cartLines.value.reduce((sum, line) => sum + line.lineTotal, 0)
  )

  const imports = computed(() => importsState.value)

  /** Giá vốn/đơn vị theo lần nhập hàng gần nhất (chỉ dùng để hiển thị ở tab Sản phẩm; Đơn hàng/Báo cáo vẫn dùng product.cost). */
  const lastImportCostPerUnitByProductId = computed(() => {
    const result: Record<number, number> = {}
    const list = [...importsState.value].sort(
      (a, b) =>
      parseTimestampAsGMT7(b.timestamp).getTime() -
      parseTimestampAsGMT7(a.timestamp).getTime()
    )
    for (const imp of list) {
      for (const item of imp.items) {
        if (item.productId in result) continue
        if (item.addedUnits > 0) {
          result[item.productId] = Math.round(item.addedCost / item.addedUnits)
        }
      }
    }
    return result
  })

  async function withProcessing<T>(fn: () => Promise<T>): Promise<T> {
    if (isProcessing.value) return undefined as T
    isProcessing.value = true
    try {
      return await fn()
    } finally {
      isProcessing.value = false
    }
  }

  function startPageLoadTimer() {
    if (import.meta.server) return
    if (pageLoadTimer) {
      clearInterval(pageLoadTimer)
      pageLoadTimer = null
    }
    processingStartTime.value = Date.now()
    lastLoadDurationMs.value = 0
    pageLoadTimer = setInterval(() => {
      if (processingStartTime.value != null) {
        lastLoadDurationMs.value = Date.now() - processingStartTime.value
      }
    }, 100)
  }

  function stopPageLoadTimer() {
    if (import.meta.server) return
    if (pageLoadTimer) {
      clearInterval(pageLoadTimer)
      pageLoadTimer = null
    }
    if (processingStartTime.value != null) {
      lastLoadDurationMs.value = Date.now() - processingStartTime.value
    }
    processingStartTime.value = null
  }

  type TabKey = 'sale' | 'products' | 'purchase' | 'orders' | 'report'

  /** Load dữ liệu tối thiểu cho tab hiện tại; các phần khác sẽ được load khi cần (lazy theo tab). */
  async function loadData(tab?: TabKey) {
    const currentTab: TabKey = tab ?? 'sale'

    // Xác định phần dữ liệu bắt buộc cho tab hiện tại
    const needProducts = !hasLoadedProducts.value
    const needSales =
      !hasLoadedSales.value &&
      (currentTab === 'orders' || currentTab === 'report')
    const needImports =
      !hasLoadedImports.value &&
      (currentTab === 'products' ||
        currentTab === 'purchase' ||
        currentTab === 'report')
    const needVendors =
      !hasLoadedVendors.value && currentTab === 'purchase'
    const needVendorPrices =
      currentTab === 'purchase' && !vendorPricesState.value.length

    if (!needProducts && !needSales && !needImports && !needVendors && !needVendorPrices) return

    // Bắt đầu đếm thời gian load cho tab hiện tại (chỉ tính loadData, không tính prefetch/background)
    startPageLoadTimer()

    return withProcessing(async () => {
      try {
        // 1) Luôn đảm bảo products trước (các tab khác phụ thuộc vào products)
        if (needProducts) {
          const res = await apiFetch<{ products: Product[] }>('/api/data/products')
          let loadedProducts = (res.products ?? EMPTY_DATA.products).map((p) => ({
            ...p,
            isHidden: p.isHidden ?? false,
            packSize: p.packSize ?? 24,
            displayOrder: p.displayOrder ?? p.id
          }))
          // Chuẩn hóa displayOrder duy nhất khi load (1..n, sửa dữ liệu cũ bị trùng trong DB)
          loadedProducts = loadedProducts
            .sort(
              (a, b) =>
                (a.displayOrder ?? a.id) - (b.displayOrder ?? b.id) ||
                a.id - b.id
            )
            .map((p, i) => ({ ...p, displayOrder: i + 1 }))
          data.value = {
            ...data.value,
            products: loadedProducts
          }
          hasLoadedProducts.value = true
        }

        // 2) Các phần còn lại chỉ load khi tab cần
        if (needSales) {
          const res = await apiFetch<{ sales: Sale[] }>('/api/data/sales')
          data.value = {
            ...data.value,
            sales: res.sales ?? []
          }
          hasLoadedSales.value = true
        }

        if (needImports) {
          const res = await apiFetch<{ imports: StockImport[] }>(
            '/api/data/imports'
          )
          const loadedImports = Array.isArray(res.imports) ? res.imports : []
          importsState.value = loadedImports
          nextImportId.value =
            loadedImports.length > 0
              ? Math.max(...loadedImports.map((i) => i.id)) + 1
              : 1
          hasLoadedImports.value = true
        }

        if (needVendors) {
          const res = await apiFetch<{ vendors: Vendor[] }>(
            '/api/data/vendors'
          )
          vendorsState.value = Array.isArray(res.vendors) ? res.vendors : []
          hasLoadedVendors.value = true
        }
        if (needVendorPrices) {
          const res = await apiFetch<{
            prices: { product_id: number; vendor_id: number; price_per_case: number; updated_at?: string | null }[]
          }>('/api/data/vendor-prices')
          vendorPricesState.value = Array.isArray(res.prices) ? res.prices : []
        }
      } catch {
        // Nếu products chưa load được thì fallback về EMPTY_DATA
        if (!hasLoadedProducts.value) {
          data.value = structuredClone(EMPTY_DATA)
        }
        // Nếu imports chưa load được thì reset về rỗng
        if (!hasLoadedImports.value) {
          importsState.value = []
          nextImportId.value = 1
        }
        if (!hasLoadedVendors.value) {
          vendorsState.value = []
        }
      } finally {
        // Dừng đồng hồ đo thời gian load cho tab hiện tại
        stopPageLoadTimer()

        // Đánh dấu đã qua lần load đầu tiên (không hiện overlay cho lần sau)
        isInitialLoad.value = false
        // Khi đã có đủ 3 phần thì coi như full-loaded
        if (hasLoadedProducts.value && hasLoadedSales.value && hasLoadedImports.value) {
          isLoaded.value = true
        }
      }
    })
  }

  /**
   * Prefetch nền toàn bộ phần dữ liệu còn thiếu.
   * Không dùng overlay / loading time, tránh ảnh hưởng cảm nhận load ban đầu.
   */
  async function prefetchAll() {
    // Nếu đã đủ 3 phần thì bỏ qua
    if (hasLoadedProducts.value && hasLoadedSales.value && hasLoadedImports.value && hasLoadedVendors.value) {
      return
    }

    try {
      const tasks: Promise<void>[] = []

      if (!hasLoadedProducts.value) {
        tasks.push(
          apiFetch<{ products: Product[] }>('/api/data/products')
            .then((res) => {
              let loadedProducts = (res.products ?? EMPTY_DATA.products).map((p) => ({
                ...p,
                isHidden: p.isHidden ?? false,
                packSize: p.packSize ?? 24,
                displayOrder: p.displayOrder ?? p.id
              }))
              loadedProducts = loadedProducts
                .sort(
                  (a, b) =>
                    (a.displayOrder ?? a.id) - (b.displayOrder ?? b.id) ||
                    a.id - b.id
                )
                .map((p, i) => ({ ...p, displayOrder: i + 1 }))
              data.value = {
                ...data.value,
                products: loadedProducts
              }
              hasLoadedProducts.value = true
            })
            .catch(() => {})
        )
      }

      if (!hasLoadedSales.value) {
        tasks.push(
          apiFetch<{ sales: Sale[] }>('/api/data/sales')
            .then((res) => {
              data.value = {
                ...data.value,
                sales: res.sales ?? []
              }
              hasLoadedSales.value = true
            })
            .catch(() => {})
        )
      }

      if (!hasLoadedImports.value) {
        tasks.push(
          apiFetch<{ imports: StockImport[] }>('/api/data/imports')
            .then((res) => {
              const loadedImports = Array.isArray(res.imports) ? res.imports : []
              importsState.value = loadedImports
              nextImportId.value =
                loadedImports.length > 0
                  ? Math.max(...loadedImports.map((i) => i.id)) + 1
                  : 1
              hasLoadedImports.value = true
            })
            .catch(() => {})
        )
      }

      if (!hasLoadedVendors.value) {
        tasks.push(
          apiFetch<{ vendors: Vendor[] }>('/api/data/vendors')
            .then((res) => {
              vendorsState.value = Array.isArray(res.vendors)
                ? res.vendors
                : []
              hasLoadedVendors.value = true
            })
            .catch(() => {})
        )
      }

      if (tasks.length) {
        await Promise.all(tasks)
      }
    } finally {
      if (hasLoadedProducts.value && hasLoadedSales.value && hasLoadedImports.value && hasLoadedVendors.value) {
        isLoaded.value = true
      }
    }
  }

  /** Chuẩn hóa displayOrder (1..n) và gửi chỉ products lên server (PATCH). Nhanh hơn saveData full. */
  async function saveProductsOnly() {
    const productsSorted = [...data.value.products].sort(
      (a, b) => (a.displayOrder ?? a.id) - (b.displayOrder ?? b.id) || a.id - b.id
    )
    const productsWithUniqueOrder = productsSorted.map((p, i) => ({
      ...p,
      displayOrder: i + 1
    }))
    await apiFetch('/api/data/products', {
      method: 'PATCH',
      body: { products: productsWithUniqueOrder }
    })
  }

  /** Full save (POST toàn bộ data). Chỉ dùng khi cần đồng bộ toàn bộ; các thao tác thường dùng API từng phần. */
  async function saveData() {
    const productsSorted = [...data.value.products].sort(
      (a, b) => (a.displayOrder ?? a.id) - (b.displayOrder ?? b.id) || a.id - b.id
    )
    const productsWithUniqueOrder = productsSorted.map((p, i) => ({
      ...p,
      displayOrder: i + 1
    }))
    const payload: PosData = {
      products: productsWithUniqueOrder,
      sales: data.value.sales,
      imports: importsState.value
    }
    await apiFetch('/api/data', {
      method: 'POST',
      body: JSON.parse(JSON.stringify(payload))
    })
  }

  async function saveProducts() {
    return withProcessing(() => saveProductsOnly())
  }

  /** Cập nhật thứ tự hiển thị sản phẩm (tab Bán hàng) và lưu vào DB. Mọi sản phẩm được gán displayOrder duy nhất từ 1 đến n. */
  async function reorderProducts(orderedProductIds: number[]) {
    return withProcessing(async () => {
    const idToOrder = new Map<number, number>()
    orderedProductIds.forEach((id, index) => idToOrder.set(id, index + 1)) // 1..n
    const n = orderedProductIds.length
    // Sản phẩm không trong danh sách: sắp theo displayOrder rồi id, gán n+1, n+2,... để không trùng
    const others = data.value.products
      .filter((p) => !idToOrder.has(p.id))
      .sort((a, b) => (a.displayOrder ?? a.id) - (b.displayOrder ?? b.id) || a.id - b.id)
    others.forEach((p, i) => {
      p.displayOrder = n + 1 + i
    })
    data.value.products.forEach((p) => {
      if (idToOrder.has(p.id)) {
        p.displayOrder = idToOrder.get(p.id)!
      }
    })
    await saveProductsOnly()
    })
  }

  function addToCart(productId: number) {
    const existing = cart.value.find((c) => c.productId === productId)
    if (existing) {
      existing.qty += 1
    } else {
      cart.value.push({ productId, qty: 1 })
    }
  }

  function updateCartQty(productId: number, delta: number) {
    const line = cart.value.find((c) => c.productId === productId)
    if (!line) return
    line.qty += delta
    if (line.qty <= 0) {
      cart.value = cart.value.filter((c) => c.productId !== productId)
    }
  }

  function clearCart() {
    cart.value = []
  }

  async function deleteSale(id: number) {
    return withProcessing(async () => {
    const sale = data.value.sales.find((s) => s.id === id)
    if (!sale) return

    for (const item of sale.items) {
      const product = data.value.products.find((p) => p.id === item.productId)
      if (!product) continue
      const currentStock = product.stock || 0
      product.stock = currentStock + item.qty
    }
    data.value.sales = data.value.sales.filter((s) => s.id !== id)
    await apiFetch(`/api/data/sales/${id}`, { method: 'DELETE' })
    })
  }

  async function checkout() {
    if (!cartLines.value.length) return
    return withProcessing(async () => {
    const zeroAmount = noPayment.value
    const payloadItems = cartLines.value.map((line) => {
      const product = data.value.products.find((p) => p.id === line.productId)!
      return {
        productId: line.productId,
        qty: line.qty,
        price: zeroAmount ? 0 : product.price,
        cost: product.cost
      }
    })

    try {
      const result = await apiFetch<PosData>('/api/checkout', {
        method: 'POST',
        body: {
          items: payloadItems
        }
      })

      data.value = {
        ...data.value,
        products: result.products,
        sales: result.sales
      }
      noPayment.value = false
      clearCart()
    } catch (err: any) {
      console.error('[checkout]', err)
      const message = err?.data?.message ?? err?.message ?? String(err)
      alert('Thanh toán thất bại: ' + message)
    }
    })
  }

  async function updateSale(
    saleId: number,
    items: {
      productId: number
      qty: number
      price: number
      cost: number
    }[]
  ) {
    if (!items.length) return
    return withProcessing(async () => {
    try {
      const result = await apiFetch<PosData>(`/api/data/sales/${saleId}`, {
        method: 'PATCH',
        body: {
          items
        }
      })
      data.value = {
        ...data.value,
        products: result.products ?? data.value.products,
        sales: result.sales ?? data.value.sales
      }
    } catch (err: any) {
      console.error('[updateSale]', err)
      const message = err?.data?.message ?? err?.message ?? String(err)
      alert('Cập nhật đơn hàng thất bại: ' + message)
    }
    })
  }

  async function importStock(
    items: {
      productId: number
      cases: number
      pricePerCase: number
      packSize: number
    }[],
    vendorId?: number | null
  ) {
    if (!items.length) return
    return withProcessing(async () => {
    const timestamp = getNowGMT7()
    const importItems: ImportItem[] = []

    for (const item of items) {
      if (!item.cases || item.cases <= 0) continue

      const product = data.value.products.find((p) => p.id === item.productId)
      if (!product) continue

      const packSize = item.packSize || product.packSize || 24
      const addedUnits = item.cases * packSize
      if (addedUnits <= 0) continue

      const oldUnits = product.stock || 0
      const oldCostPerUnit = product.cost || 0
      const addedCost = item.cases * item.pricePerCase
      const newUnits = oldUnits + addedUnits

      const newCostPerUnit =
        newUnits > 0
          ? Math.round((oldCostPerUnit * oldUnits + addedCost) / newUnits)
          : 0

      product.stock = newUnits
      product.cost = newCostPerUnit
      product.packSize = packSize

      importItems.push({
        productId: item.productId,
        cases: item.cases,
        pricePerCase: item.pricePerCase,
        packSize,
        addedUnits,
        addedCost
      })
    }

    if (importItems.length) {
      const id = nextImportId.value++
      const newImport: StockImport = {
        id,
        timestamp,
        items: importItems,
        vendorId: vendorId ?? null
      }
      importsState.value = [...importsState.value, newImport]
      await apiFetch('/api/data/imports', {
        method: 'POST',
        body: newImport
      })
    }
    })
  }

  async function deleteImport(importId: number) {
    const record = importsState.value.find((imp) => imp.id === importId)
    if (!record) return
    return withProcessing(async () => {
    for (const item of record.items) {
      const product = data.value.products.find((p) => p.id === item.productId)
      if (!product) continue
      const currentUnits = product.stock || 0
      const currentCostPerUnit = product.cost || 0
      const newUnits = currentUnits - item.addedUnits
      if (newUnits <= 0) {
        product.stock = 0
        product.cost = 0
        continue
      }
      const previousCostPerUnit =
        (currentCostPerUnit * currentUnits - item.addedCost) / newUnits
      product.stock = newUnits
      product.cost = Math.round(previousCostPerUnit)
    }
    importsState.value = importsState.value.filter((imp) => imp.id !== importId)
    await apiFetch(`/api/data/imports/${importId}`, { method: 'DELETE' })
    })
  }

  async function reloadVendors() {
    const res = await apiFetch<{ vendors: Vendor[] }>('/api/data/vendors')
    vendorsState.value = Array.isArray(res.vendors) ? res.vendors : []
  }

  async function addVendor(payload: { name: string; phone?: string; note?: string }) {
    await apiFetch('/api/data/vendors', {
      method: 'POST',
      body: payload
    })
    await reloadVendors()
  }

  async function updateVendor(id: number, patch: Partial<Vendor>) {
    await apiFetch(`/api/data/vendors/${id}`, {
      method: 'PATCH',
      body: patch
    })
    await reloadVendors()
  }

  async function deleteVendor(id: number) {
    await apiFetch(`/api/data/vendors/${id}`, {
      method: 'DELETE'
    })
    await reloadVendors()
  }

  async function saveVendorPrice(
    productId: number,
    vendorId: number,
    pricePerCase: number
  ) {
    await apiFetch('/api/data/vendor-prices', {
      method: 'PATCH',
      body: { productId, vendorId, pricePerCase }
    })
    const existingIndex = vendorPricesState.value.findIndex(
      (row) => row.product_id === productId && row.vendor_id === vendorId
    )
    const now = getNowGMT7()
    if (existingIndex >= 0) {
      vendorPricesState.value[existingIndex].price_per_case = pricePerCase
      vendorPricesState.value[existingIndex].updated_at = now
    } else {
      vendorPricesState.value.push({
        product_id: productId,
        vendor_id: vendorId,
        price_per_case: pricePerCase,
        updated_at: now
      })
    }
  }

  return {
    data,
    products,
    sales,
    namedProducts,
    cart,
    noPayment,
    cartLines,
    cartTotal,
    imports,
    vendors,
    vendorPrices,
    isProcessing,
    processingStartTime,
    lastLoadDurationMs,
    isInitialLoad,
    lastImportCostPerUnitByProductId,
    loadData,
    prefetchAll,
    saveProducts,
    saveData,
    saveProductsOnly,
    reorderProducts,
    addToCart,
    updateCartQty,
    clearCart,
    checkout,
    updateSale,
    deleteSale,
    importStock,
    deleteImport,
    addVendor,
    updateVendor,
    deleteVendor,
    saveVendorPrice
  }
}

