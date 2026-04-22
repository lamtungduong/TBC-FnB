const normalizeDesc = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

// Cache dùng chung cho toàn process — giới hạn gọi TPBank tối đa 1 lần / 2s.
// Trang / chỉ có 1 user, 2s/lần là mức phổ biến với các giải pháp tương tự.
let txCache: { data: any; fetchedAt: number } | null = null
const BANK_POLL_INTERVAL_MS = 2_000

async function fetchTransactions(signal: AbortSignal): Promise<any> {
  const now = Date.now()
  if (txCache && now - txCache.fetchedAt < BANK_POLL_INTERVAL_MS) {
    return txCache.data
  }
  const data = await $fetch<any>('http://10.1.2.11:3030/api/transactions?days=1', {
    timeout: 8000,
    signal,
  })
  txCache = { data, fetchedAt: Date.now() }
  return data
}

/**
 * Long-polling endpoint: giữ kết nối tối đa ~25s, check transaction mỗi khi cache hết hạn.
 * Gọi TPBank tối đa 1 lần / 8s (dù có nhiều client đang polling cùng lúc).
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
      const data = await fetchTransactions(ac.signal)

      const txList: Array<{ description: string; amount: string; creditDebitIndicator: string }> =
        data?.data?.transactionInfos ?? []

      const matched = txList.find(
        (tx) =>
          tx.creditDebitIndicator === 'CRDT' &&
          normalizeDesc(tx.description).includes(searchToken) &&
          Number(tx.amount) === amount
      )

      if (matched) {
        console.log(`[check-payment] FOUND after ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
        return { found: true }
      }

      // Đợi đến khi cache cũ hết hạn để lần sau fetch TPBank mới
      const cacheAge = Date.now() - (txCache?.fetchedAt ?? 0)
      const waitMs = Math.max(0, BANK_POLL_INTERVAL_MS - cacheAge)
      if (waitMs > 0) {
        await sleep(waitMs)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw createError({ statusCode: 499, message: 'Client closed request' })
      }
      // Lỗi tạm thời → đợi đủ 1 interval rồi thử lại
      try {
        await sleep(BANK_POLL_INTERVAL_MS)
      } catch {
        throw createError({ statusCode: 499, message: 'Client closed request' })
      }
    }
  }

  console.log(`[check-payment] TIMEOUT after ${((Date.now() - startTime) / 1000).toFixed(1)}s — no match`)
  return { found: false }
})
