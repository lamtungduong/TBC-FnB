export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { saveFullPosData } = await import('../posData')
  await saveFullPosData(body)
  return body
})
