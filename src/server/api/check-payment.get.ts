const normalizeDesc = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

export default defineEventHandler(async (event) => {
  const ac = new AbortController()
  event.node.req.on('close', () => ac.abort())

  const query = getQuery(event)
  const description = String(query.description ?? '')
  const amount = Number(query.amount ?? 0)

  try {
    const data = await $fetch<any>('http://10.1.2.11:3030/api/transactions?days=1', {
      timeout: 5000,
      signal: ac.signal,
    })

    const txList: Array<{ description: string; amount: string; creditDebitIndicator: string }> =
      data?.data?.transactionInfos ?? []

    const searchToken = normalizeDesc(description)
    const found = txList.some(
      (tx) =>
        tx.creditDebitIndicator === 'CRDT' &&
        normalizeDesc(tx.description).includes(searchToken) &&
        Number(tx.amount) === amount
    )

    console.log(`[check-payment] found=${found} desc="${description}" amount=${amount}`)
    return { found }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw createError({ statusCode: 499, message: 'Client closed request' })
    }
    throw createError({ statusCode: 502, message: `Cannot reach payment API: ${err?.message ?? err}` })
  }
})
