import type { StockImport } from '../../posData'

export default defineEventHandler(async (event) => {
  const body = await readBody<StockImport>(event)
  if (!body?.id || !Array.isArray(body?.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid import body: need id and items'
    })
  }
  const { addImport } = await import('../../posData')
  await addImport(body)
})
