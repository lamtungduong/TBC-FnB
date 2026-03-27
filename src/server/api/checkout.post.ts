export default defineEventHandler(async (event) => {
  const body = await readBody<{
    items: {
      productId: number
      qty: number
      price: number
    }[]
  }>(event)

  const { applyCheckout } = await import('../posData')
  const data = await applyCheckout(body.items)
  return data
})
