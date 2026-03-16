export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid vendor id'
    })
  }

  const { query } = await import('../../../utils/db')
  await query('DELETE FROM vendors WHERE id = $1', [id])

  return { ok: true }
})

