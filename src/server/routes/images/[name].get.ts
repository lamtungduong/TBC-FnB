import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { extname, join } from 'path'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const fileName = String(name || '')

  // Ảnh local được lưu trong src/public/images (trùng với upload-image.post.ts)
  const filePath = join(process.cwd(), 'src', 'public', 'images', fileName)

  try {
    await fs.access(filePath)
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: `Image not found: /images/${fileName}`
    })
  }

  const ext = extname(filePath).toLowerCase()
  let contentType = 'application/octet-stream'
  if (ext === '.png') contentType = 'image/png'
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
  else if (ext === '.gif') contentType = 'image/gif'
  else if (ext === '.webp') contentType = 'image/webp'

  event.node.res.setHeader('Content-Type', contentType)

  const stream = createReadStream(filePath)
  return sendStream(event, stream)
})

