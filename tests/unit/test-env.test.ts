import { describe, expect, it } from 'vitest'
import { assertTestDatabase, assertTestRedis, databaseName, testEnv } from '../helpers/test-env'

/** The guards that keep integration tests away from the dev database and the app's Redis. */

describe('test environment guards', () => {
  it('points the tests at a *_test database and Redis database 1', () => {
    expect(databaseName(testEnv.DATABASE_URL)).toMatch(/_test$/)
    expect(new URL(testEnv.REDIS_URL).pathname).not.toBe('/0')
    expect(() => assertTestDatabase(testEnv.DATABASE_URL)).not.toThrow()
    expect(() => assertTestRedis(testEnv.REDIS_URL)).not.toThrow()
  })

  it.each([
    'postgresql://kitchen:kitchen@localhost:5432/kitchen_erp?schema=public',
    'postgresql://kitchen:kitchen@localhost:5432/kitchen_erp_test_backup',
    'postgresql://kitchen:kitchen@localhost:5432/',
  ])('refuses to wipe %s', url => {
    expect(() => assertTestDatabase(url)).toThrow(/must end in _test/)
  })

  it.each(['redis://localhost:6379', 'redis://localhost:6379/0', 'redis://localhost:6379/abc'])('refuses Redis %s', url => {
    expect(() => assertTestRedis(url)).toThrow(/Refusing Redis/)
  })

  it('accepts Redis database 1 and above', () => {
    expect(() => assertTestRedis('redis://localhost:6379/1')).not.toThrow()
    expect(() => assertTestRedis('redis://localhost:6379/15')).not.toThrow()
  })
})
