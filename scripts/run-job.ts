import { DAILY_JOBS, getNotificationQueue } from '@/lib/queue'

/**
 * Puts a scheduled job on the queue now, instead of waiting for its time —
 * the worker runs it exactly as it would the scheduled one. For testing, and
 * for a manual re-run.
 *
 * Usage: npm run job -- low-stock-check   (npm run worker must be running)
 */
const RUNNABLE = DAILY_JOBS.map(job => job.name)

async function main() {
  const name = process.argv[2] ?? ''
  if (!RUNNABLE.includes(name)) {
    console.error(`Usage: npm run job -- <${RUNNABLE.join(' | ')}>`)
    process.exitCode = 1
    return
  }

  const queue = getNotificationQueue()
  const job = await queue.add(name, {})
  console.log(`queued ${name} (job ${job.id}) — the worker runs it`)
  await queue.close()
}

main()
