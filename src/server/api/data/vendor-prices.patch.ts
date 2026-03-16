export default defineEventHandler(async (event) => {
  const body = await readBody<{
    productId: number
    vendorId: number
    pricePerCase: number
  }>(event)

  const productId = Number(body?.productId)
  const vendorId = Number(body?.vendorId)
  const pricePerCase = Number(body?.pricePerCase ?? 0)

  if (!productId || !vendorId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'productId and vendorId are required'
    })
  }

  const { query } = await import('../../utils/db')
  await query(
    `
    INSERT INTO product_vendor_prices (product_id, vendor_id, price_per_case, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (product_id, vendor_id) DO UPDATE SET
      price_per_case = EXCLUDED.price_per_case,
      updated_at = EXCLUDED.updated_at
    `,
    [productId, vendorId, pricePerCase]
  )

  return { ok: true }
})

