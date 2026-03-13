import type { Sale } from '../../posData'

export default defineEventHandler(async () => {
  const { getSalesOnly } = await import('../../posData')
  const sales: Sale[] = await getSalesOnly()
  return { sales }
})

