export default defineEventHandler(async (event) => {
  // Khi client hủy request (AbortController / browser refresh / tab đóng),
  // Node.js nhận sự kiện 'close' trên req → abort outbound call đến payment API
  const ac = new AbortController()
  event.node.req.on('close', () => ac.abort())

  try {
    const data = await $fetch('http://10.1.2.11:3030/api/transactions?days=1', {
      timeout: 5000,
      signal: ac.signal
    })
    return data
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Client đã ngắt kết nối — trả 499 (standard "Client Closed Request")
      throw createError({ statusCode: 499, message: 'Client closed request' })
    }
    throw createError({
      statusCode: 502,
      message: `Cannot reach payment API: ${err?.message ?? err}`
    })
  }
})
