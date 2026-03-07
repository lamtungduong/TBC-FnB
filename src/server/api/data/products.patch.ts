import type { Product } from '../../posData'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ products: Product[] }>(event)
  const products = Array.isArray(body?.products) ? body.products : []
  if (!products.length) return
  const { saveProductsOnly } = await import('../../posData')
  await saveProductsOnly(products)
})
