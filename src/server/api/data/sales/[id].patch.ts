export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid sale id'
    })
  }

  const body = await readBody(event)
  if (!body || !Array.isArray((body as any).items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid payload'
    })
  }

  const items = (body as { items: { productId: number; qty: number; price: number; cost?: number }[] }).items
  const { updateSaleItems } = await import('../../../posData')
  const data = await updateSaleItems(id, items)
  return data
})
