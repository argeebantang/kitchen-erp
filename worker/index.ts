import { Worker, type Job } from 'bullmq'
import {
  NOTIFICATIONS_QUEUE,
  PR_SUBMITTED,
  redisConnection,
  type PrSubmittedJob,
} from '@/lib/queue'
import { NotificationService } from '@/services/notification.service'
/**
 * Background job consumer — a SEPARATE PROCESS from the Next.js app.
 *
 * A BullMQ Worker holds a long-lived Redis connection and blocks waiting for
 * jobs. Next.js has nowhere to run that: its server answers a request and moves
 * on, and in development it re-evaluates modules on every hot reload — so a
 * Worker constructed inside the app would be duplicated on each reload, every
 * copy competing for the same jobs.
 *
 * Nothing under app/ imports this file. That is what makes the duplication
 * impossible, rather than relying on a flag to suppress it.
 *
 * Run with: npm run worker
 */

async function handlePrSubmitted(job: Job<PrSubmittedJob>) {
  const count = await NotificationService.notifyPurchaseRequestSubmitted(
    job.data.purchaseRequestId,
  )
  console.log(`  → wrote ${count} notification(s)`)
}

const worker = new Worker<PrSubmittedJob>(
  NOTIFICATIONS_QUEUE,
  async job => {
    console.log(`[worker] job ${job.id} (${job.name})`)

    switch (job.name) {
      case PR_SUBMITTED:
        return handlePrSubmitted(job)
      default:
        // Throwing marks the job FAILED rather than quietly completing it, so an
        // unrecognised job name is visible instead of vanishing.
        throw new Error(`Unknown job name: ${job.name}`)
    }
  },
  { connection: redisConnection },
)

worker.on('completed', job => console.log(`[worker] job ${job.id} completed`))
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} FAILED: ${err.message}`))

console.log(`[worker] listening on "${NOTIFICATIONS_QUEUE}" — Ctrl+C to stop`)

/**
 * Without this, Ctrl+C kills the process mid-job and the job stays 'active'
 * until its lock expires — it eventually retries, but only after a delay.
 * close() lets the current job finish and hands the connection back cleanly.
 */
async function shutdown(signal: string) {
  console.log(`\n[worker] ${signal} received, finishing current job…`)
  await worker.close()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
