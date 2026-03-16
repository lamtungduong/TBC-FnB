import type { Vendor } from '../../posData'

export default defineEventHandler(async (event) => {
  const body = await readBody<Pick<Vendor, 'name' | 'phone' | 'note'>>(event)
  const name = body?.name?.trim() || ''
  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Tên nhà cung cấp là bắt buộc'
    })
  }

  const { query } = await import('../../utils/db')
  const nextIdResult = await query<{ id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM vendors'
  )
  const id = nextIdResult.rows[0]?.id ?? 1

  await query(
    'INSERT INTO vendors (id, name, phone, note, is_hidden) VALUES ($1, $2, $3, $4, false)',
    [id, name, body.phone ?? '', body.note ?? '']
  )

  return { id }
})

