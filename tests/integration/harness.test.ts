import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getNotificationQueue } from '@/lib/queue'
import { MaterialService } from '@/services/material.service'
import { createWorld } from '../helpers/fixtures'
import { databaseName } from '../helpers/test-env'

/**
 * The harness itself: the right database, a clean start for every test, the
 * fixtures, and Redis database 1. If one of these fails, every other
 * integration test result is meaningless — so they run first and say why.
 */

describe('integration harness', () => {
  it('is connected to a *_test database', async () => {
    const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    expect(name).toMatch(/_test$/)
    expect(name).toBe(databaseName(process.env.DATABASE_URL!))
  })

  it('has every migration applied', async () => {
    const [{ pending }] = await prisma.$queryRaw<{ pending: bigint }[]>`
      SELECT count(*) AS pending FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`
    const [{ applied }] = await prisma.$queryRaw<{ applied: bigint }[]>`SELECT count(*) AS applied FROM _prisma_migrations`
    expect(Number(pending)).toBe(0)
    expect(Number(applied)).toBeGreaterThan(0)
  })

  it('builds the fixture world', async () => {
    const world = await createWorld()
    expect(world.branches.kitchen.type).toBe('COMMISSARY')
    expect(world.branches.outlet.type).toBe('OUTLET')
    expect(await prisma.user.count()).toBe(Object.keys(world.users).length)
    expect(await prisma.bOMItem.count({ where: { bomId: world.boms.lechon.id } })).toBe(2)
  })

  it('creates through a service and reads it back', async () => {
    const world = await createWorld()
    const created = await MaterialService.create({
      code: 'RM-GARLIC', name: 'Garlic', categoryId: world.categories.spices.id, unitId: world.units.kg.id, reorderPoint: '2.5',
    })
    expect(created.success).toBe(true)
    if (!created.success) return

    const read = await MaterialService.getById(created.data.id)
    expect(read).toMatchObject({
      success: true,
      data: { code: 'RM-GARLIC', categoryName: 'Spices', unitAbbreviation: 'kg', reorderPoint: '2.5', currentPrice: null },
    })
  })

  it('gets a service refusal as a result, not a throw', async () => {
    const world = await createWorld()
    const duplicate = await MaterialService.create({
      code: world.materials.pork.code, name: 'Another pig', categoryId: world.categories.meat.id, unitId: world.units.kg.id, reorderPoint: '0',
    })
    expect(duplicate).toEqual({ success: false, error: 'A material with that code already exists', status: 409 })
  })

  it('starts every test from an empty database', async () => {
    // The tests above created rows; none survive into this one.
    expect(await prisma.material.count()).toBe(0)
    expect(await prisma.user.count()).toBe(0)
  })

  it('queues jobs on Redis database 1, never the app’s database 0', async () => {
    const client = await getNotificationQueue().client
    expect(client.options.db).toBe(1)
  })
})
