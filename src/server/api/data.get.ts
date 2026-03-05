export default defineEventHandler(async () => {
  const { getPosData } = await import('../posData')
  const data = await getPosData()
  return data
})
