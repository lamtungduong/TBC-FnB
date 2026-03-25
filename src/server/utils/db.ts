import { Pool, PoolClient, QueryResult } from 'pg'
import { createError } from 'h3'

const connectionString = process.env.DATABASE_URL

const pool =
  connectionString
    ? new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 8000
      })
    : null

export async function getClient(): Promise<PoolClient> {
  if (!pool) {
    throw createError({
      statusCode: 500,
      statusMessage: '[db] Missing DATABASE_URL'
    })
  }
  try {
    return await pool.connect()
  } catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: `[db] Failed to connect: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  const client = await getClient()
  try {
    return await client.query<T>(text, params)
  } catch (err) {
    // Preserve original Postgres error message in JSON response (prod-safe, no password).
    throw createError({
      statusCode: 500,
      statusMessage: `[db] Query failed: ${err instanceof Error ? err.message : String(err)}`
    })
  } finally {
    client.release()
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw createError({
      statusCode: 500,
      statusMessage: `[db] Transaction failed: ${err instanceof Error ? err.message : String(err)}`
    })
  } finally {
    client.release()
  }
}

