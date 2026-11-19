import { Prisma, PrismaClient } from '@prisma/client'
import { config } from '@/lib/config'

/**
 * SQL the assistant wrote, run through the read-only kitchen_ai_reader login
 * (Week 9 Task 3, F3; migration 20261119100000_ai_reader_role). A client of
 * its own, never the app's: the app's login can write, this one cannot, and
 * what it may read is the grants in that migration.
 */

const globalForReader = globalThis as unknown as { aiReader: PrismaClient | undefined }

function reader(): PrismaClient | null {
  if (!config.aiDatabaseUrl) return null
  // One client per process, like lib/prisma.ts — dev hot reload would otherwise open a pool per edit.
  // No 'error' log: a refused query is an expected answer for Claude, and anything else is thrown.
  globalForReader.aiReader ??= new PrismaClient({ datasourceUrl: config.aiDatabaseUrl, log: ['warn'] })
  return globalForReader.aiReader
}

export type ReadOnlyRows = { rows: Record<string, unknown>[]; truncated: boolean }

/** Ok with the rows, or the database's own message for SQL Claude can fix (a typo, a column it may not read, a timeout). */
export type ReadOnlyQueryResult = { ok: true; data: ReadOnlyRows } | { ok: false; error: string }

/** Postgres's message for a statement that failed, from Prisma's P2010 "Raw query failed". */
function databaseMessage(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2010') return null
  const message = error.meta?.message
  return typeof message === 'string' ? message : error.message
}

export const AiReaderRepository = {
  isConfigured(): boolean {
    return config.aiDatabaseUrl !== null
  },

  /**
   * One SELECT, at most maxRows rows (truncated says more were there). Wrapped
   * as a subquery, so anything but a single query is a syntax error, and the
   * LIMIT is ours whatever the SQL says; prepared statements refuse a second
   * statement anyway. Read-only and time-limited on the transaction too, in
   * case the role's own settings were changed.
   */
  async query(sql: string, maxRows: number, timeoutMs: number): Promise<ReadOnlyQueryResult> {
    const client = reader()
    if (!client) throw new Error('[AI] AI_DATABASE_URL is not set')
    const body = sql.trim().replace(/;\s*$/, '')
    try {
      const rows = await client.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`)
        // New lines around the SQL, so a trailing -- comment cannot swallow the wrapper.
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM (\n${body}\n) AS ai_query LIMIT ${Math.trunc(maxRows) + 1}`)
      }, { maxWait: 2000, timeout: timeoutMs + 2000 })
      return { ok: true, data: { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows } }
    } catch (error) {
      const message = databaseMessage(error)
      if (message === null) throw error
      return { ok: false, error: message }
    }
  },
}
