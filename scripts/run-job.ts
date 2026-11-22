import { AI_SCHEDULED_JOBS, DAILY_JOBS, getAiQueue, getNotificationQueue } from '@/lib/queue'

/**
 * Puts a scheduled job on the queue now, instead of waiting for its time —
 * the worker runs it exactly as it would the scheduled one. For testing, and
 * for a manual re-run. Daily jobs go on the notifications queue; the weekly
 * and monthly AI reports (Week 10) on the ai queue.
 *
 * Usage: npm run job -- low-stock-check   (npm run worker must be running)
 */
const DAILY = DAILY_JOBS.map(job => job.name)
const AI    = AI_SCHEDULED_JOBS.map(job => job.name)

async function main() {
  const name = process.argv[2] ?? ''
  if (!DAILY.includes(name) && !AI.includes(name)) {
    console.error(`Usage: npm run job -- <${[...DAILY, ...AI].join(' | ')}>`)
    process.exitCode = 1
    return
  }

  const queue = AI.includes(name) ? getAiQueue() : getNotificationQueue()
  const job = await queue.add(name, {})
  console.log(`queued ${name} (job ${job.id}) — the worker runs it`)
  await queue.close()
}

main()
