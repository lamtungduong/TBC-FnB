export default defineEventHandler(async () => {
  try {
    const data = await $fetch('http://10.1.2.11:3030/api/transactions?days=1', {
      timeout: 5000
    })
    return data
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      message: `Cannot reach payment API: ${err?.message ?? err}`
    })
  }
})
