import { addDays } from '@/lib/dates'
import { eachDay } from './calendar'
import { cook, deliver, planTomorrow } from './kitchen'
import type { Cast } from './master'
import { recordSales, submitRequests } from './outlet'
import { placeOrders, receiveDeliveries } from './procurement'
import { convert, qualityCheck, sendReturns, writeOffs } from './waste'
import { createRandom } from './random'
import { loadWorld, type World } from './world'

/** Purchasing starts a week early, so the kitchens have stock on the first day. */
export const PURCHASING_LEAD_IN_DAYS = 7

/**
 * The history, one day at a time, in the order a day runs:
 *   morning     supplier deliveries counted in; purchasing orders
 *               Lechon about to expire converted into Paksiw; expired lots written off
 *               the kitchens cook what was scheduled for today (and Las Piñas Bopis is taste-checked)
 *   late morning deliveries to the outlets
 *   afternoon   outlets ask for tomorrow; the kitchens plan it and schedule the runs
 *   closing     outlets record their sales and send back Lechon that will not last
 *
 * The evening of the last day plans today: today's runs are approved and
 * waiting to start, and today's requests are planned, for whoever tests next.
 */
export async function simulate(cast: Cast, firstDay: string, lastDay: string, seed: number): Promise<World> {
  const world = await loadWorld(cast, createRandom(seed), lastDay)

  for (const date of eachDay(addDays(firstDay, -PURCHASING_LEAD_IN_DAYS), lastDay)) {
    await receiveDeliveries(world, date)
    await placeOrders(world, date)
    if (date >= firstDay) {
      await convert(world, date)
      await writeOffs(world, date)
      const lotsBefore = world.lots.length
      await cook(world, date)
      await qualityCheck(world, date, world.lots.slice(lotsBefore))
      await deliver(world, date)
    }
    if (date >= addDays(firstDay, -1)) {
      await submitRequests(world, date)
      await planTomorrow(world, date)
    }
    if (date >= firstDay) {
      await recordSales(world, date)
      await sendReturns(world, date)
    }
  }
  return world
}
