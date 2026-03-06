import type { PoolClient } from 'pg'
import { query, withTransaction } from './utils/db'

export type Product = {
  id: number
  name: string
  image: string
  price: number
  cost: number
  stock: number
  packSize?: number
  isHidden?: boolean
  displayOrder?: number
}

export type SaleItem = {
  productId: number
  qty: number
  price: number
  cost: number
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
}

export type PosData = {
  products: Product[]
  sales: Sale[]
  imports: StockImport[]
}

export async function getPosData(): Promise<PosData> {
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      pack_size INTEGER DEFAULT 24,
      is_hidden BOOLEAN DEFAULT false,
      display_order INTEGER DEFAULT 0
    )
  `)
  await query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0
  `).catch(() => {})
  await query(`
    UPDATE products SET display_order = id WHERE display_order = 0 OR display_order IS NULL
  `).catch(() => {})
  await query(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL
    )
  `)
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
  const productsResult = await query<{
    id: number
    name: string
    image: string
    price: number
    cost: number
    stock: number
    pack_size: number | null
    is_hidden: boolean | null
    display_order: number | null
  }>('SELECT id, name, image, price, cost, stock, pack_size, is_hidden, COALESCE(display_order, id) AS display_order FROM products ORDER BY display_order ASC NULLS LAST, id ASC')

  const salesResult = await query<{
    id: number
    timestamp: Date
  }>('SELECT id, timestamp FROM sales ORDER BY id ASC')

  const saleItemsResult = await query<{
    sale_id: number
    product_id: number
    qty: number
    price: number
    cost: number
  }>('SELECT sale_id, product_id, qty, price, cost FROM sale_items ORDER BY sale_id ASC, id ASC')

  const products: Product[] = productsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    image: row.image,
    price: row.price,
    cost: row.cost,
    stock: row.stock,
    packSize: row.pack_size ?? 24,
    isHidden: row.is_hidden ?? false,
    displayOrder: row.display_order ?? row.id
  }))

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
    timestamp: row.timestamp.toISOString(),
    items: itemsBySaleId.get(row.id) ?? []
  }))

  await query(`
    CREATE TABLE IF NOT EXISTS stock_imports (
      id INTEGER PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL
    )
  `)
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

  const importsResult = await query<{ id: number; timestamp: Date }>(
    'SELECT id, timestamp FROM stock_imports ORDER BY id ASC'
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
    timestamp: row.timestamp.toISOString(),
    items: itemsByImportId.get(row.id) ?? []
  }))

  return { products, sales, imports }
}

export async function saveFullPosData(data: PosData): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        cost INTEGER NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        pack_size INTEGER DEFAULT 24,
        is_hidden BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        price INTEGER NOT NULL,
        cost INTEGER NOT NULL
      )
    `)
    await client.query('DROP TABLE IF EXISTS stock_import_items')
    await client.query('DROP TABLE IF EXISTS stock_imports')
    await client.query(`
      CREATE TABLE stock_imports (
        id INTEGER PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL
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

    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0').catch(() => {})
    for (const p of data.products) {
      await client.query(
        `
        INSERT INTO products (id, name, image, price, cost, stock, pack_size, is_hidden, display_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          p.id,
          p.name ?? '',
          p.image ?? '',
          p.price ?? 0,
          p.cost ?? 0,
          p.stock ?? 0,
          p.packSize ?? 24,
          p.isHidden ?? false,
          p.displayOrder ?? p.id
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
        INSERT INTO stock_imports (id, timestamp)
        VALUES ($1, $2)
      `,
        [imp.id, imp.timestamp]
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
  items: SaleItem[]
): Promise<PosData> {
  return withTransaction(async (client: PoolClient) => {
    for (const item of items) {
      await client.query(
        `
        UPDATE products
        SET stock = GREATEST(0, COALESCE(stock, 0) - $1)
        WHERE id = $2
      `,
        [item.qty, item.productId]
      )
    }

    const nextIdResult = await client.query<{ id: number }>(
      'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM sales'
    )
    const saleId = nextIdResult.rows[0]?.id ?? 1

    const now = new Date().toISOString()
    await client.query(
      `
      INSERT INTO sales (id, timestamp)
      VALUES ($1, $2)
    `,
      [saleId, now]
    )

    for (const item of items) {
      await client.query(
        `
        INSERT INTO sale_items (sale_id, product_id, qty, price, cost)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [saleId, item.productId, item.qty, item.price, item.cost]
      )
    }

    const fullData = await getPosData()
    return fullData
  })
}

