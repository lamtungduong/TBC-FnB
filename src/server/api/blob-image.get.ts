import { Readable } from 'node:stream'

/** Giải mã URL đến dạng ổn định (tránh lệch encoding khi query bị encode nhiều lần). */
function decodeUrlStable(encoded: string): string {
  let s = encoded
  let prev = ''
  while (s !== prev) {
    prev = s
    try {
      s = decodeURIComponent(s)
    } catch {
      break
    }
  }
  return s
}

/**
 * Proxy ảnh từ Vercel Blob private store.
 * URL private không mở trực tiếp trên browser, nên stream qua route này.
 */
export default defineEventHandler(async (event) => {
  let url = getQuery(event).url as string | undefined
  if (!url || !url.includes('blob.vercel-storage.com')) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid url' })
  }
  url = decodeUrlStable(url)

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw createError({ statusCode: 503, statusMessage: 'Blob not configured' })
  }

  const { get } = await import('@vercel/blob')
  const result = await get(url, { access: 'private' })

  if (!result || result.statusCode !== 200) {
    throw createError({ statusCode: 404, statusMessage: 'Image not found' })
  }

  event.node.res.setHeader('Content-Type', result.blob.contentType || 'image/png')
  event.node.res.setHeader('X-Content-Type-Options', 'nosniff')
  event.node.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  event.node.res.setHeader('Pragma', 'no-cache')

  const nodeStream = Readable.fromWeb(result.stream)
  return sendStream(event, nodeStream)
})
