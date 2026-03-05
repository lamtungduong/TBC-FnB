import { Pool, PoolClient, QueryResult } from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // Fail fast in server context if database URL is not configured
  console.error(
    '[db] DATABASE_URL is not set. Please configure a Postgres connection string.'
  )
}

const pool = new Pool(
  connectionString
    ? {
        connectionString
      }
    : undefined
)

export async function getClient(): Promise<PoolClient> {
  return pool.connect()
}

export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  const client = await getClient()
  try {
    return await client.query<T>(text, params)
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
    throw err
  } finally {
    client.release()
  }
}

