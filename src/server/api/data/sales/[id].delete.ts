export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid sale id'
    })
  }
  const { deleteSaleById } = await import('../../../posData')
  await deleteSaleById(id)
})
