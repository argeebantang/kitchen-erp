import { prisma } from '@/lib/prisma'
import { addDays, todayIsoDate } from '@/lib/dates'
import { HISTORY_EMAIL_DOMAIN } from './cast'
import { cleanHistory } from './clean'
import { createCast } from './master'
import { PURCHASING_LEAD_IN_DAYS, simulate } from './simulate'

/**
 * History data for the KitchenAI features (Week 10 Task 1,
 * docs/2026-11-22-week10-history-data.md): days of realistic, back-dated
 * activity — purchasing, production, outlet orders, deliveries, waste —
 * written straight to the database.
 *
 *   npm run seed:history                    90 days ending yesterday
 *   npm run seed:history -- --days 60       a shorter window
 *   npm run seed:history -- --seed 7        a different, still repeatable, history
 *   npm run seed:history -- --clean         remove all of it
 *
 * Needs `npx prisma db seed` first. Sends no notifications and calls no AI.
 */

const DEFAULT_DAYS = 90
const DEFAULT_SEED = 20261122

type Options = { clean: boolean; days: number; seed: number }

function parseArgs(argv: string[]): Options {
  const options: Options = { clean: false, days: DEFAULT_DAYS, seed: DEFAULT_SEED }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--clean') options.clean = true
    else if (arg === '--days' || arg === '--seed') {
      const value = Number(argv[++i])
      if (!Number.isInteger(value) || value < 1 || (arg === '--days' && value > 365)) {
        throw new Error(`${arg} needs a whole number${arg === '--days' ? ' from 1 to 365' : ' of at least 1'}`)
      }
      if (arg === '--days') options.days = value
      else options.seed = value
    } else {
      throw new Error(`Unknown option ${arg}. Use --clean, --days <n> or --seed <n>.`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.clean) {
    const result = await cleanHistory()
    if (!result.removed) {
      console.log(result.reason)
      if (result.reason.startsWith('Nothing was removed')) process.exitCode = 1
      return
    }
    console.log('History data removed:')
    for (const { label, rows } of result.counts) console.log(`  ${String(rows).padStart(6)}  ${label}`)
    console.log(`  ${String(result.levelsRecomputed).padStart(6)}  stock levels at your branches recomputed from the ledger`)
    return
  }

  const existing = await prisma.user.count({ where: { email: { endsWith: `@${HISTORY_EMAIL_DOMAIN}` } } })
  if (existing > 0) {
    console.log('History data already exists. Run with --clean first to make it again.')
    process.exitCode = 1
    return
  }

  // The window ends yesterday: today belongs to whoever is testing.
  const lastDay  = addDays(todayIsoDate(), -1)
  const firstDay = addDays(lastDay, -(options.days - 1))
  // The cast exists a few days before purchasing starts.
  const castFrom = new Date(`${addDays(firstDay, -(PURCHASING_LEAD_IN_DAYS + 3))}T08:00:00+08:00`)

  console.log(`History ${firstDay} → ${lastDay} (${options.days} days, seed ${options.seed})`)
  const cast = await createCast(castFrom)
  console.log(`  ${cast.kitchens.length} kitchens: ${cast.kitchens.map(k => k.name).join(', ')}`)
  console.log(`  ${cast.outlets.length} outlets: ${cast.outlets.map(o => o.name).join(', ')}`)
  console.log(`  ${Object.keys(cast.staff).length} history staff, ${cast.suppliers.length} suppliers`)

  const started = Date.now()
  const world = await simulate(cast, firstDay, lastDay, options.seed)
  for (const [label, total] of world.counts) console.log(`  ${String(total).padStart(6)}  ${label}`)
  console.log(`  ${world.incoming.length} deliveries still on their way at the end`)
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s.`)
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    if (!process.argv.includes('--clean')) {
      console.error('The history may be half-written: npm run seed:history -- --clean removes what was made.')
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
