import { query } from '../utils/db'

export default defineEventHandler(async () => {
  await query('SELECT 1')
  return { ok: true }
})
