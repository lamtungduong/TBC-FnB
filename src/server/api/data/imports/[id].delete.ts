export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid import id'
    })
  }
  const { deleteImportById, getProductsOnly } = await import('../../../posData')
  await deleteImportById(id)
  const products = await getProductsOnly()
  return { products }
})
