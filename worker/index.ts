import { Worker, type Job } from 'bullmq'
import {
  CONVERSION_ORDER_DECIDED,
  CONVERSION_ORDER_SUBMITTED,
  DAILY_JOBS,
  getNotificationQueue,
  LOW_STOCK_CHECK,
  NOTIFICATIONS_QUEUE,
  PR_SUBMITTED,
  PRODUCTION_COMPLETION_DECIDED,
  PRODUCTION_COMPLETION_REPORTED,
  PRODUCTION_ORDER_DECIDED,
  PRODUCTION_ORDER_SUBMITTED,
  redisConnection,
  STOCK_RECONCILIATION,
  type ConversionOrderJob,
  type PrSubmittedJob,
  type ProductionOrderJob,
} from '@/lib/queue'
import { BUSINESS_TIME_ZONE, todayIsoDate } from '@/lib/dates'
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

async function handleProductionOrderSubmitted(job: Job<ProductionOrderJob>) {
  const count = await NotificationService.notifyProductionOrderSubmitted(job.data.productionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleProductionOrderDecided(job: Job<ProductionOrderJob>) {
  const count = await NotificationService.notifyProductionOrderDecided(job.data.productionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleCompletionReported(job: Job<ProductionOrderJob>) {
  const count = await NotificationService.notifyCompletionReported(job.data.productionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleCompletionDecided(job: Job<ProductionOrderJob>) {
  const count = await NotificationService.notifyCompletionDecided(job.data.productionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleConversionSubmitted(job: Job<ConversionOrderJob>) {
  const count = await NotificationService.notifyConversionSubmitted(job.data.conversionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleConversionDecided(job: Job<ConversionOrderJob>) {
  const count = await NotificationService.notifyConversionDecided(job.data.conversionOrderId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleLowStockCheck() {
  // The run's own date, in Manila — it is also what stops a second run today.
  const date = todayIsoDate()
  const count = await NotificationService.notifyLowStock(date)
  console.log(`  → ${date}: wrote ${count} notification(s)`)
}

async function handleStockReconciliation() {
  const date = todayIsoDate()
  const { mismatches, written } = await NotificationService.notifyStockMismatches(date)
  console.log(mismatches === 0
    ? '  → all stock levels match the ledger'
    : `  → ${mismatches} mismatch(es); wrote ${written} notification(s)`)
}

// Untyped data: each job name carries its own payload, and the handler for
// that name declares it.
const worker = new Worker(
  NOTIFICATIONS_QUEUE,
  async job => {
    console.log(`[worker] job ${job.id} (${job.name})`)

    switch (job.name) {
      case PR_SUBMITTED:
        return handlePrSubmitted(job)
      case PRODUCTION_ORDER_SUBMITTED:
        return handleProductionOrderSubmitted(job)
      case PRODUCTION_ORDER_DECIDED:
        return handleProductionOrderDecided(job)
      case PRODUCTION_COMPLETION_REPORTED:
        return handleCompletionReported(job)
      case PRODUCTION_COMPLETION_DECIDED:
        return handleCompletionDecided(job)
      case CONVERSION_ORDER_SUBMITTED:
        return handleConversionSubmitted(job)
      case CONVERSION_ORDER_DECIDED:
        return handleConversionDecided(job)
      case LOW_STOCK_CHECK:
        return handleLowStockCheck()
      case STOCK_RECONCILIATION:
        return handleStockReconciliation()
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
 * Registers the clock-driven jobs. upsertJobScheduler keys each schedule by
 * its id (the job name), so every restart replaces the schedule instead of
 * adding another — and a changed pattern takes effect on the next restart.
 * Redis keeps the schedule, so a run falls due even if the worker was down at
 * 06:00; it runs when the worker is back.
 */
async function scheduleDailyJobs() {
  const queue = getNotificationQueue()
  for (const { name, pattern } of DAILY_JOBS) {
    await queue.upsertJobScheduler(name, { pattern, tz: BUSINESS_TIME_ZONE }, { name, data: {} })
    const next = (await queue.getJobScheduler(name))?.next
    const when = next === undefined
      ? 'unknown'
      : new Date(next).toLocaleString('en-PH', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
    console.log(`[worker] ${name} scheduled "${pattern}" ${BUSINESS_TIME_ZONE} — next run ${when}`)
  }
}

scheduleDailyJobs().catch(err => console.error(`[worker] scheduling FAILED: ${err.message}`))

/**
 * Without this, Ctrl+C kills the process mid-job and the job stays 'active'
 * until its lock expires — it eventually retries, but only after a delay.
 * close() lets the current job finish and hands the connection back cleanly.
 */
async function shutdown(signal: string) {
  console.log(`\n[worker] ${signal} received, finishing current job…`)
  await worker.close()
  await getNotificationQueue().close()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
