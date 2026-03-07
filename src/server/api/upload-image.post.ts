// Giới hạn body ~4MB (Vercel serverless thường 4.5MB) để tránh lỗi khi deploy
const MAX_BODY_BYTES = 4 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileName: string; dataUrl: string }>(event)

  const { fileName, dataUrl } = body
  if (!fileName || !dataUrl?.startsWith('data:')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid payload' })
  }

  const base64 = dataUrl.split(',')[1]
  if (!base64) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid dataUrl' })
  }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > MAX_BODY_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Ảnh quá lớn. Vui lòng chọn ảnh dưới khoảng 3MB.'
    })
  }
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_')
  const contentTypeMatch = dataUrl.match(/^data:(image\/[a-z+]+);/)
  const contentType = contentTypeMatch ? contentTypeMatch[1] : 'image/png'

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Blob chưa cấu hình. Thêm BLOB_READ_WRITE_TOKEN vào .env (xem VERCEL_BLOB_SETUP.md).'
    })
  }

  try {
    const { put } = await import('@vercel/blob')
    const blob = await put(safeName, buffer, {
      access: 'private',
      contentType,
      allowOverwrite: true
    })
    return { fileName: safeName, url: blob.url }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message || 'Upload Blob thất bại. Kiểm tra Storage đã kết nối project và Redeploy.'
    })
  }
})
