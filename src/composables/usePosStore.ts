import { computed } from 'vue'

export type Product = {
  id: number
  name: string
  image: string // relative path trong thư mục "Hình ảnh"
  price: number
  cost: number
  stock: number
  packSize?: number
  isHidden?: boolean
}

export type SaleItem = {
  productId: number
  qty: number
  price: number
  cost: number
}

export type Sale = {
  id: number
  timestamp: string // ISO
  items: SaleItem[]
}

export type PosData = {
  products: Product[]
  sales: Sale[]
  imports?: StockImport[]
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

export const usePosStore = () => {
  const data = useState<PosData>('pos-data', () => structuredClone(EMPTY_DATA))
  const isLoaded = useState<boolean>('pos-loaded', () => false)

  const cart = useState<{ productId: number; qty: number }[]>('pos-cart', () => [])
  const noPayment = useState<boolean>('pos-no-payment', () => false)
  const importsState = useState<StockImport[]>('pos-imports', () => [])
  const nextImportId = useState<number>('pos-imports-next-id', () => 1)

  const products = computed(() => data.value.products)
  const sales = computed(() => data.value.sales)

  const namedProducts = computed(() =>
    data.value.products.filter(
      (p) => p.name && p.name.trim() !== '' && !p.isHidden
    )
  )

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

  async function loadData() {
    if (isLoaded.value) return
    try {
      const res = await $fetch<PosData>('/api/data')
      const loadedProducts = (res.products ?? EMPTY_DATA.products).map((p) => ({
        ...p,
        isHidden: p.isHidden ?? false,
        packSize: p.packSize ?? 24
      }))
      data.value = {
        products: loadedProducts,
        sales: res.sales ?? []
      }
      const loadedImports = res.imports ?? []
      importsState.value = loadedImports
      nextImportId.value =
        loadedImports.length > 0
          ? Math.max(...loadedImports.map((i) => i.id)) + 1
          : 1
    } catch {
      data.value = structuredClone(EMPTY_DATA)
    } finally {
      isLoaded.value = true
    }
  }

  async function saveData() {
    await $fetch('/api/data', {
      method: 'POST',
      body: {
        products: data.value.products,
        sales: data.value.sales,
        imports: importsState.value
      }
    })
  }

  async function saveProducts() {
    await saveData()
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
    const sale = data.value.sales.find((s) => s.id === id)
    if (!sale) return

    for (const item of sale.items) {
      const product = data.value.products.find((p) => p.id === item.productId)
      if (!product) continue

      const currentStock = product.stock || 0
      product.stock = currentStock + item.qty
    }

    data.value.sales = data.value.sales.filter((s) => s.id !== id)
    await saveData()
  }

  async function checkout() {
    if (!cartLines.value.length) return
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

    const result = await $fetch<PosData>('/api/checkout', {
      method: 'POST',
      body: {
        items: payloadItems
      }
    })

    data.value = {
      products: result.products,
      sales: result.sales
    }
    noPayment.value = false
    clearCart()
  }

  async function importStock(
    items: {
      productId: number
      cases: number
      pricePerCase: number
      packSize: number
    }[]
  ) {
    if (!items.length) return

    const timestamp = new Date().toISOString()
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
      importsState.value = [
        ...importsState.value,
        {
          id,
          timestamp,
          items: importItems
        }
      ]
      await saveData()
    }
  }

  async function deleteImport(importId: number) {
    const record = importsState.value.find((imp) => imp.id === importId)
    if (!record) return

    for (const item of record.items) {
      const product = data.value.products.find((p) => p.id === item.productId)
      if (!product) continue

      const currentUnits = product.stock || 0
      const currentCostPerUnit = product.cost || 0
      const addedUnits = item.addedUnits
      const addedCost = item.addedCost

      const newUnits = currentUnits - addedUnits

      if (newUnits <= 0) {
        product.stock = 0
        product.cost = 0
        continue
      }

      const previousCostPerUnit =
        (currentCostPerUnit * currentUnits - addedCost) / newUnits

      product.stock = newUnits
      product.cost = Math.round(previousCostPerUnit)
    }

    importsState.value = importsState.value.filter((imp) => imp.id !== importId)
    await saveData()
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
    loadData,
    saveProducts,
    saveData,
    addToCart,
    updateCartQty,
    clearCart,
    checkout,
    deleteSale,
    importStock,
    deleteImport
  }
}

