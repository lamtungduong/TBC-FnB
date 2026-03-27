import type { StockImport } from '../../posData'

export default defineEventHandler(async (event) => {
  const body = await readBody<StockImport>(event)
  if (!body?.id || !Array.isArray(body?.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid import body: need id and items'
    })
  }
  const { addImport, getProductsOnly } = await import('../../posData')
  await addImport(body)
  const products = await getProductsOnly()
  return { products }
})
