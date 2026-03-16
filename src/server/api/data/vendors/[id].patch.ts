import type { Vendor } from '../../../posData'

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid vendor id'
    })
  }

  const body = await readBody<Partial<Vendor>>(event)
  const { query } = await import('../../../utils/db')

  await query(
    `
    UPDATE vendors
    SET name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        note = COALESCE($4, note),
        is_hidden = COALESCE($5, is_hidden)
    WHERE id = $1
    `,
    [id, body.name ?? null, body.phone ?? null, body.note ?? null, body.isHidden ?? null]
  )

  return { ok: true }
})

