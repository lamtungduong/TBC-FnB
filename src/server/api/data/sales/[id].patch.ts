export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid sale id'
    })
  }

  const body = await readBody<{
    items: {
      productId: number
      qty: number
      price: number
      cost: number
    }[]
  }>(event)

  if (!Array.isArray(body.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid payload'
    })
  }

  const { updateSaleItems } = await import('../../../posData')
  const data = await updateSaleItems(id, body.items)
  return data
}

