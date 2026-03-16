import type { ProductVendorPriceRow } from '../../posData'

export default defineEventHandler(async () => {
  const { getProductVendorPrices } = await import('../../posData')
  const prices: ProductVendorPriceRow[] = await getProductVendorPrices()
  return { prices }
})

