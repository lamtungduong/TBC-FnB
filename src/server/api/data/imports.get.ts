import type { StockImport } from '../../posData'

export default defineEventHandler(async () => {
  const { getImportsOnly } = await import('../../posData')
  const imports: StockImport[] = await getImportsOnly()
  return { imports }
})

