import type { Product } from '../../posData'

export default defineEventHandler(async () => {
  const { getProductsOnly } = await import('../../posData')
  const products: Product[] = await getProductsOnly()
  return { products }
})

