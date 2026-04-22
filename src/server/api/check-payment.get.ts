const normalizeDesc = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

/**
 * Long-polling endpoint: giữ kết nối tối đa MAX_DURATION_MS, liên tục query bank API
 * cho đến khi tìm thấy giao dịch khớp hoặc hết thời gian.
 *
 * Query params: description (string), amount (number)
 * Response: { found: true } | { found: false }
 */
export default defineEventHandler(async (event) => {
  const ac = new AbortController()
  event.node.req.on('close', () => ac.abort())

  const query = getQuery(event)
  const description = String(query.description ?? '')
  const amount = Number(query.amount ?? 0)
  const searchToken = normalizeDesc(description)

  const MAX_DURATION_MS = 25_000
  const startTime = Date.now()

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      ac.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
        },
        { once: true }
      )
    })

  while (Date.now() - startTime < MAX_DURATION_MS) {
    if (ac.signal.aborted) {
      throw createError({ statusCode: 499, message: 'Client closed request' })
    }

    try {
      const data = await $fetch<any>('http://10.1.2.11:3030/api/transactions?days=1', {
        timeout: 5000,
        signal: ac.signal,
      })

      const txList: Array<{ description: string; amount: string; creditDebitIndicator: string }> =
        data?.data?.transactionInfos ?? []

      const matched = txList.find(
        (tx) =>
          tx.creditDebitIndicator === 'CRDT' &&
          normalizeDesc(tx.description).includes(searchToken) &&
          Number(tx.amount) === amount
      )

      if (matched) {
        return { found: true }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw createError({ statusCode: 499, message: 'Client closed request' })
      }
      // Lỗi tạm thời (network, timeout) → đợi ngắn rồi thử lại
      try {
        await sleep(1000)
      } catch {
        throw createError({ statusCode: 499, message: 'Client closed request' })
      }
    }
  }

  return { found: false }
})
