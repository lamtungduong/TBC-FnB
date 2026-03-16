import type { Vendor } from '../../posData'

export default defineEventHandler(async () => {
  const { getVendorsOnly } = await import('../../posData')
  const vendors: Vendor[] = await getVendorsOnly()
  return { vendors }
})

