export default defineEventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') ?? '', 10)
  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid import id'
    })
  }
  const { deleteImportById } = await import('../../../posData')
  await deleteImportById(id)
})
