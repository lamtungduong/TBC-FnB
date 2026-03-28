import type { PoolClient } from 'pg'
import { query, withTransaction } from './utils/db'

const GMT7_OFFSET_MINUTES = 7 * 60

/** Lấy thời điểm hiện tại theo GMT+7, định dạng "YYYY-MM-DD HH:mm:ss". Không phụ thuộc timezone server. */
function getNowGMT7(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const gmt7 = new Date(d.getTime() + GMT7_OFFSET_MINUTES * 60000)
  const y = gmt7.getUTCFullYear()
  const m = gmt7.getUTCMonth() + 1
  const day = gmt7.getUTCDate()
  const h = gmt7.getUTCHours()
  const mi = gmt7.getUTCMinutes()
  const s = gmt7.getUTCSeconds()
  return `${y}-${pad(m)}-${pad(day)} ${pad(h)}:${pad(mi)}:${pad(s)}`
}

/** Chuỗi timestamp từ DB (literal "YYYY-MM-DD HH:mm:ss") - cắt bớt phần lẻ giây nếu có. */
function timestampLiteralFromDb(raw: string): string {
  const s = raw.trim()
  return s.length > 19 ? s.slice(0, 19) : s
}

/** Chạy DDL một lần khi khởi động; tránh chạy mỗi lần getPosData() gây lock và chậm. */
let schemaReady: Promise<void> | null = null

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady
  schemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        pack_size INTEGER DEFAULT 24,
        is_hidden BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0,
        min_stock NUMERIC(10,2) DEFAULT 0,
        max_stock NUMERIC(10,2) DEFAULT 0
      )
    `)
    await query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0
    `).catch(() => {})
    await query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock NUMERIC(10,2) DEFAULT 0
    `).catch(() => {})
    await query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock NUMERIC(10,2) DEFAULT 0
    `).catch(() => {})
    await query(`
      ALTER TABLE products
      ALTER COLUMN min_stock TYPE NUMERIC(10,2) USING min_stock::NUMERIC(10,2),
      ALTER COLUMN max_stock TYPE NUMERIC(10,2) USING max_stock::NUMERIC(10,2)
    `).catch(() => {})
    await query(`
      UPDATE products SET display_order = id WHERE display_order = 0 OR display_order IS NULL
    `).catch(() => {})
    // Migration: xóa các cột không dùng khỏi products
    // - cost: tính từ stock_import_items
    // - stock: tính từ SUM(added_units) - SUM(qty)
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS cost`).catch(() => {})
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS stock`).catch(() => {})
    await query(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL
      )
    `)
    await query(`
      ALTER TABLE sales ALTER COLUMN timestamp TYPE TIMESTAMP USING (timestamp AT TIME ZONE 'UTC')
    `).catch(() => {})
    await query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        price INTEGER NOT NULL,
        cost INTEGER NOT NULL
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS stock_imports (
        id INTEGER PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        vendor_id INTEGER
      )
    `)
    await query(`
      ALTER TABLE stock_imports ALTER COLUMN timestamp TYPE TIMESTAMP USING (timestamp AT TIME ZONE 'UTC')
    `).catch(() => {})
    await query(`
      ALTER TABLE stock_imports ADD COLUMN IF NOT EXISTS vendor_id INTEGER
    `).catch(() => {})
    await query(`
      CREATE TABLE IF NOT EXISTS stock_import_items (
        id SERIAL PRIMARY KEY,
        import_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        cases INTEGER NOT NULL,
        price_per_case INTEGER NOT NULL,
        pack_size INTEGER NOT NULL,
        added_units INTEGER NOT NULL,
        added_cost INTEGER NOT NULL
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        min_order_cases INTEGER NOT NULL DEFAULT 5,
        lead_time_days INTEGER NOT NULL DEFAULT 3,
        is_hidden BOOLEAN NOT NULL DEFAULT false
      )
    `)
    await query(`
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false
    `).catch(() => {})
    await query(`
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS min_order_cases INTEGER NOT NULL DEFAULT 5
    `).catch(() => {})
    await query(`
      ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 3
    `).catch(() => {})

    await query(`
      CREATE TABLE IF NOT EXISTS product_vendor_prices (
        product_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        price_per_case INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP,
        PRIMARY KEY (product_id, vendor_id)
      )
    `)
    await query(`
      ALTER TABLE product_vendor_prices
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP
    `).catch(() => {})
  })()
  return schemaReady
}

type ProductVendorPriceRow = {
  product_id: number
  vendor_id: number
  price_per_case: number
  updated_at: string | null
}

export type Product = {
  id: number
  name: string
  image: string
  price: number
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

/** Payload từ FE khi checkout — cost không cần gửi, server tự tính từ stock_import_items. */
export type CheckoutItem = {
  productId: number
  qty: number
  price: number
}

export type Sale = {
  id: number
  timestamp: string
  items: SaleItem[]
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
  minOrderCases?: number
  leadTimeDays?: number
  isHidden?: boolean
}

export type PosData = {
  products: Product[]
  sales: Sale[]
  imports: StockImport[]
  vendors?: Vendor[]
  vendorPrices?: ProductVendorPriceRow[]
}

async function getProductsOnly(): Promise<Product[]> {
  await ensureSchema()

  const productsResult = await query<{
    id: number
    name: string
    image: string
    price: number
    stock: number
    pack_size: number | null
    is_hidden: boolean | null
    display_order: number | null
    min_stock: number | null
    max_stock: number | null
  }>(`
    SELECT p.id, p.name, p.image, p.price,
      GREATEST(0, COALESCE(imp.total_units, 0) - COALESCE(sale.total_qty, 0))::INTEGER AS stock,
      p.pack_size, p.is_hidden, COALESCE(p.display_order, p.id) AS display_order,
      p.min_stock, p.max_stock
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(added_units) AS total_units
      FROM stock_import_items
      GROUP BY product_id
    ) imp ON p.id = imp.product_id
    LEFT JOIN (
      SELECT product_id, SUM(qty) AS total_qty
      FROM sale_items
      GROUP BY product_id
    ) sale ON p.id = sale.product_id
    ORDER BY display_order ASC NULLS LAST, p.id ASC
  `)

  const products: Product[] = productsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    image: row.image,
    price: row.price,
    stock: row.stock,
    packSize: row.pack_size ?? 24,
    isHidden: row.is_hidden ?? false,
    displayOrder: row.display_order ?? row.id,
    minStock: row.min_stock ?? 0,
    maxStock: row.max_stock ?? 0
  }))

  return products
}

async function getSalesOnly(): Promise<Sale[]> {
  await ensureSchema()

  const salesResult = await query<{
    id: number
    timestamp: string
  }>('SELECT id, timestamp::text AS timestamp FROM sales ORDER BY id ASC')

  const saleItemsResult = await query<{
    sale_id: number
    product_id: number
    qty: number
    price: number
    cost: number
  }>('SELECT sale_id, product_id, qty, price, cost FROM sale_items ORDER BY sale_id ASC, id ASC')

  const itemsBySaleId = new Map<number, SaleItem[]>()
  for (const row of saleItemsResult.rows) {
    const list = itemsBySaleId.get(row.sale_id) ?? []
    list.push({
      productId: row.product_id,
      qty: row.qty,
      price: row.price,
      cost: row.cost
    })
    itemsBySaleId.set(row.sale_id, list)
  }

  const sales: Sale[] = salesResult.rows.map((row) => ({
    id: row.id,
    timestamp: timestampLiteralFromDb(row.timestamp),
    items: itemsBySaleId.get(row.id) ?? []
  }))

  return sales
}

async function getImportsOnly(): Promise<StockImport[]> {
  await ensureSchema()

  const importsResult = await query<{
    id: number
    timestamp: string
    vendor_id: number | null
  }>(
    'SELECT id, timestamp::text AS timestamp, vendor_id FROM stock_imports ORDER BY id ASC'
  )
  const importItemsResult = await query<{
    import_id: number
    product_id: number
    cases: number
    price_per_case: number
    pack_size: number
    added_units: number
    added_cost: number
  }>('SELECT import_id, product_id, cases, price_per_case, pack_size, added_units, added_cost FROM stock_import_items ORDER BY import_id ASC')

  const itemsByImportId = new Map<number, ImportItem[]>()
  for (const row of importItemsResult.rows) {
    const list = itemsByImportId.get(row.import_id) ?? []
    list.push({
      productId: row.product_id,
      cases: row.cases,
      pricePerCase: row.price_per_case,
      packSize: row.pack_size,
      addedUnits: row.added_units,
      addedCost: row.added_cost
    })
    itemsByImportId.set(row.import_id, list)
  }

  const imports: StockImport[] = importsResult.rows.map((row) => ({
    id: row.id,
    timestamp: timestampLiteralFromDb(row.timestamp),
    items: itemsByImportId.get(row.id) ?? [],
    vendorId: row.vendor_id ?? null
  }))

  return imports
}

async function getVendorsOnly(): Promise<Vendor[]> {
  await ensureSchema()
  const result = await query<{
    id: number
    name: string
    phone: string
    note: string
    min_order_cases: number | null
    lead_time_days: number | null
    is_hidden: boolean | null
  }>(
    'SELECT id, name, phone, note, min_order_cases, lead_time_days, is_hidden FROM vendors ORDER BY id ASC'
  )
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    note: row.note,
    minOrderCases: row.min_order_cases ?? 5,
    leadTimeDays: row.lead_time_days ?? 3,
    isHidden: row.is_hidden ?? false
  }))
}

async function getProductVendorPrices(): Promise<ProductVendorPriceRow[]> {
  await ensureSchema()
  const result = await query<ProductVendorPriceRow>(
    'SELECT product_id, vendor_id, price_per_case, updated_at::text AS updated_at FROM product_vendor_prices'
  )
  return result.rows
}

export async function getPosData(): Promise<PosData> {
  const [products, sales, imports, vendors, vendorPrices] = await Promise.all([
    getProductsOnly(),
    getSalesOnly(),
    getImportsOnly(),
    getVendorsOnly(),
    getProductVendorPrices()
  ])
  return { products, sales, imports, vendors, vendorPrices }
}

export {
  getProductsOnly,
  getSalesOnly,
  getImportsOnly,
  getVendorsOnly,
  getProductVendorPrices
}
export async function saveFullPosData(data: PosData): Promise<void> {
  await ensureSchema()

  await withTransaction(async (client) => {
    await client.query('DROP TABLE IF EXISTS stock_import_items')
    await client.query('DROP TABLE IF EXISTS stock_imports')
    await client.query(`
      CREATE TABLE stock_imports (
        id INTEGER PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        vendor_id INTEGER
      )
    `)
    await client.query(`
      CREATE TABLE stock_import_items (
        id SERIAL PRIMARY KEY,
        import_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        cases INTEGER NOT NULL,
        price_per_case INTEGER NOT NULL,
        pack_size INTEGER NOT NULL,
        added_units INTEGER NOT NULL,
        added_cost INTEGER NOT NULL
      )
    `)

    await client.query('DELETE FROM sale_items')
    await client.query('DELETE FROM sales')
    await client.query('DELETE FROM products')
    for (const p of data.products) {
      await client.query(
        `
        INSERT INTO products (id, name, image, price, pack_size, is_hidden, display_order, min_stock, max_stock)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          p.id,
          p.name ?? '',
          p.image ?? '',
          p.price ?? 0,
          p.packSize ?? 24,
          p.isHidden ?? false,
          p.displayOrder ?? p.id,
          p.minStock ?? 0,
          p.maxStock ?? 0
        ]
      )
    }

    for (const sale of data.sales) {
      await client.query(
        `
        INSERT INTO sales (id, timestamp)
        VALUES ($1, $2)
      `,
        [sale.id, sale.timestamp]
      )

      for (const item of sale.items) {
        await client.query(
          `
          INSERT INTO sale_items (sale_id, product_id, qty, price, cost)
          VALUES ($1, $2, $3, $4, $5)
        `,
          [sale.id, item.productId, item.qty, item.price, item.cost]
        )
      }
    }

    const imports = data.imports ?? []
    for (const imp of imports) {
      await client.query(
        `
        INSERT INTO stock_imports (id, timestamp, vendor_id)
        VALUES ($1, $2, $3)
      `,
        [imp.id, imp.timestamp, imp.vendorId ?? null]
      )
      for (const item of imp.items) {
        await client.query(
          `
          INSERT INTO stock_import_items (import_id, product_id, cases, price_per_case, pack_size, added_units, added_cost)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
          [
            imp.id,
            item.productId,
            item.cases,
            item.pricePerCase,
            item.packSize,
            item.addedUnits,
            item.addedCost
          ]
        )
      }
    }
  })
}

export async function applyCheckout(
  items: CheckoutItem[]
): Promise<PosData> {
  await withTransaction(async (client: PoolClient) => {
    const nextIdResult = await client.query<{ id: number }>(
      'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM sales'
    )
    const saleId = nextIdResult.rows[0]?.id ?? 1

    const now = getNowGMT7()
    await client.query(
      `
      INSERT INTO sales (id, timestamp)
      VALUES ($1, $2)
    `,
      [saleId, now]
    )

    // Tính giá vốn trung bình từ lịch sử nhập hàng
    const productIds = [...new Set(items.map((i) => i.productId))]
    const costResult = await client.query<{ product_id: number; avg_cost: number }>(
      `SELECT product_id,
        CASE WHEN SUM(added_units) > 0
          THEN ROUND(SUM(added_cost)::numeric / SUM(added_units))
          ELSE 0
        END AS avg_cost
       FROM stock_import_items
       WHERE product_id = ANY($1)
       GROUP BY product_id`,
      [productIds]
    )
    const costByProductId = new Map<number, number>(
      costResult.rows.map((r) => [r.product_id, Number(r.avg_cost)])
    )

    for (const item of items) {
      await client.query(
        `
        INSERT INTO sale_items (sale_id, product_id, qty, price, cost)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [saleId, item.productId, item.qty, item.price, costByProductId.get(item.productId) ?? 0]
      )
    }
  })
  // Lấy dữ liệu sau khi commit, tránh giữ 2 connection và transaction kéo dài
  return getPosData()
}

export async function updateSaleItems(
  saleId: number,
  items: (Omit<SaleItem, 'cost'> & { cost?: number })[]
): Promise<PosData> {
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM sale_items WHERE sale_id = $1', [
      saleId
    ])

    // Tính giá vốn từ imports cho các item chưa có cost (item mới thêm vào đơn)
    const zeroCostProductIds = [...new Set(items.filter((i) => !i.cost).map((i) => i.productId))]
    const importCostMap = new Map<number, number>()
    if (zeroCostProductIds.length > 0) {
      const costResult = await client.query<{ product_id: number; avg_cost: number }>(
        `SELECT product_id,
          CASE WHEN SUM(added_units) > 0
            THEN ROUND(SUM(added_cost)::numeric / SUM(added_units))
            ELSE 0
          END AS avg_cost
         FROM stock_import_items
         WHERE product_id = ANY($1)
         GROUP BY product_id`,
        [zeroCostProductIds]
      )
      for (const r of costResult.rows) {
        importCostMap.set(r.product_id, Number(r.avg_cost))
      }
    }

    for (const item of items) {
      const cost = item.cost || importCostMap.get(item.productId) || 0
      await client.query(
        `
        INSERT INTO sale_items (sale_id, product_id, qty, price, cost)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [saleId, item.productId, item.qty, item.price, cost]
      )
    }
  })

  return getPosData()
}

/** Chỉ cập nhật products (UPSERT), không đụng sales/imports. Không ghi stock (tồn kho tính từ nhập − bán). */
export async function saveProductsOnly(products: Product[]): Promise<void> {
  await ensureSchema() // ensureSchema đã xử lý toàn bộ migrations (display_order, min_stock NUMERIC, max_stock NUMERIC)

  for (const p of products) {
    await query(
      `
      INSERT INTO products (id, name, image, price, pack_size, is_hidden, display_order, min_stock, max_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        image = EXCLUDED.image,
        price = EXCLUDED.price,
        pack_size = EXCLUDED.pack_size,
        is_hidden = EXCLUDED.is_hidden,
        display_order = EXCLUDED.display_order,
        min_stock = EXCLUDED.min_stock,
        max_stock = EXCLUDED.max_stock
      `,
      [
        p.id,
        p.name ?? '',
        p.image ?? '',
        p.price ?? 0,
        p.packSize ?? 24,
        p.isHidden ?? false,
        p.displayOrder ?? p.id,
        p.minStock ?? 0,
        p.maxStock ?? 0
      ]
    )
  }
}

/** Thêm một đơn nhập hàng: INSERT import + items, cập nhật pack_size (tồn kho tính từ nhập − bán). */
export async function addImport(imp: StockImport): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO stock_imports (id, timestamp, vendor_id) VALUES ($1, $2, $3)`,
      [imp.id, imp.timestamp, imp.vendorId ?? null]
    )
    for (const item of imp.items) {
      await client.query(
        `INSERT INTO stock_import_items (import_id, product_id, cases, price_per_case, pack_size, added_units, added_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          imp.id,
          item.productId,
          item.cases,
          item.pricePerCase,
          item.packSize,
          item.addedUnits,
          item.addedCost
        ]
      )
      await client.query(
        'UPDATE products SET pack_size = $1 WHERE id = $2',
        [item.packSize, item.productId]
      )
    }
  })
}

/** Xóa một đơn nhập hàng (tồn kho tính từ nhập − bán). */
export async function deleteImportById(importId: number): Promise<void> {
  const importsResult = await query<{ id: number }>(
    'SELECT id FROM stock_imports WHERE id = $1',
    [importId]
  )
  if (importsResult.rows.length === 0) return

  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM stock_import_items WHERE import_id = $1', [
      importId
    ])
    await client.query('DELETE FROM stock_imports WHERE id = $1', [importId])
  })
}

/** Xóa một đơn bán: xóa sale + sale_items (tồn kho tính từ nhập − bán). */
export async function deleteSaleById(saleId: number): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM sale_items WHERE sale_id = $1', [saleId])
    await client.query('DELETE FROM sales WHERE id = $1', [saleId])
  })
}

