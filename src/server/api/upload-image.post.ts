import { promises as fs } from 'fs'
import { join } from 'path'

const IMAGES_DIR = join(process.cwd(), 'src', 'public', 'images')

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

  // Trên Vercel: dùng Blob (chỉ load package khi có token → local không chậm)
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (token) {
    try {
      const { put } = await import('@vercel/blob')
      const blob = await put(safeName, buffer, {
        access: 'private',
        contentType: 'image/png'
      })
      return { fileName: safeName, url: blob.url }
    } catch (err: any) {
      throw createError({
        statusCode: 500,
        statusMessage: err?.message || 'Upload Blob thất bại. Kiểm tra Storage đã kết nối project và Redeploy.'
      })
    }
  }

  // Local: ghi vào thư mục public/images
  await fs.mkdir(IMAGES_DIR, { recursive: true })
  const filePath = join(IMAGES_DIR, safeName)
  await fs.writeFile(filePath, buffer)
  return { fileName: safeName }
})
