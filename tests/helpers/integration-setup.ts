import { afterAll, beforeEach } from 'vitest'
import { closeConnections, resetDatabase } from './database'

/** Loaded into every integration test file (vitest.config.ts, setupFiles). */

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await closeConnections()
})
