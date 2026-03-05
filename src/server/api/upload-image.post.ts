import { promises as fs } from 'fs'
import { join } from 'path'

// Lưu ảnh vào thư mục public/images trong project.
// Ảnh sẽ được serve qua route /images/* tuỳ chỉnh.
const IMAGES_DIR = join(process.cwd(), 'src', 'public', 'images')

export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileName: string; dataUrl: string }>(event)

  const { fileName, dataUrl } = body
  if (!fileName || !dataUrl?.startsWith('data:')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid payload' })
  }

  const base64 = dataUrl.split(',')[1]
  const buffer = Buffer.from(base64, 'base64')

  await fs.mkdir(IMAGES_DIR, { recursive: true })
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_')
  const filePath = join(IMAGES_DIR, safeName)

  await fs.writeFile(filePath, buffer)

  return { fileName: safeName }
})

