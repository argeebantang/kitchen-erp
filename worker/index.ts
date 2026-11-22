import { Worker, type Job } from 'bullmq'
import {
  AI_QUEUE,
  COST_VARIANCE_EXPLAIN,
  getAiQueue,
  type CostVarianceJob,
  WASTE_PATTERN_REPORT,
  WASTE_PATTERN_WEEKLY,
  AI_SCHEDULED_JOBS,
  SUPPLIER_PERFORMANCE_MONTHLY,
  SUPPLIER_PERFORMANCE_REPORT,
  type SupplierPerformanceJob,
  REORDER_EXPLAIN,
  type ReorderJob,
  type WastePatternJob,
  CONVERSION_ORDER_DECIDED,
  CONVERSION_ORDER_SUBMITTED,
  DAILY_JOBS,
  END_OF_DAY_SUMMARY,
  EXPIRY_CHECK,
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
  RETURN_SENT,
  STOCK_REQUEST_DECIDED,
  STOCK_REQUEST_SUBMITTED,
  TRANSFER_DECIDED,
  TRANSFER_RECEIVED,
  TRANSFER_SUBMITTED,
  WRITE_OFF_DECIDED,
  WRITE_OFF_SUBMITTED,
  type ConversionOrderJob,
  type PrSubmittedJob,
  type ProductionOrderJob,
  type StockRequestJob,
  type StockTransferJob,
  type WriteOffJob,
} from '@/lib/queue'
import { BUSINESS_TIME_ZONE, isoWeekKey, todayIsoDate } from '@/lib/dates'
import { NotificationService } from '@/services/notification.service'
import { CostVarianceService } from '@/services/cost-variance.service'
import { WastePatternService } from '@/services/waste-pattern.service'
import { lastCompleteMonth, SupplierPerformanceService } from '@/services/supplier-performance.service'
import { ReorderService } from '@/services/reorder.service'

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

async function handleWriteOffSubmitted(job: Job<WriteOffJob>) {
  const count = await NotificationService.notifyWriteOffSubmitted(job.data.writeOffId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleWriteOffDecided(job: Job<WriteOffJob>) {
  const count = await NotificationService.notifyWriteOffDecided(job.data.writeOffId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleTransferSubmitted(job: Job<StockTransferJob>) {
  const count = await NotificationService.notifyTransferSubmitted(job.data.stockTransferId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleTransferDecided(job: Job<StockTransferJob>) {
  const count = await NotificationService.notifyTransferDecided(job.data.stockTransferId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleTransferReceived(job: Job<StockTransferJob>) {
  const count = await NotificationService.notifyTransferReceived(job.data.stockTransferId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleStockRequestSubmitted(job: Job<StockRequestJob>) {
  const count = await NotificationService.notifyStockRequestSubmitted(job.data.stockRequestId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleStockRequestDecided(job: Job<StockRequestJob>) {
  const count = await NotificationService.notifyStockRequestDecided(job.data.stockRequestId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleReturnSent(job: Job<StockTransferJob>) {
  const count = await NotificationService.notifyReturnSent(job.data.stockTransferId)
  console.log(`  → wrote ${count} notification(s)`)
}

async function handleLowStockCheck() {
  // The run's own date, in Manila — it is also what stops a second run today.
  const date = todayIsoDate()
  const count = await NotificationService.notifyLowStock(date)
  console.log(`  → ${date}: wrote ${count} notification(s)`)
}

async function handleExpiryCheck() {
  const date = todayIsoDate()
  const { lots, written } = await NotificationService.notifyExpiringLots(date)
  console.log(lots === 0 ? '  → no lots expired or expiring within 48 h' : `  → ${lots} lot(s) flagged; wrote ${written} notification(s)`)
}

async function handleEndOfDaySummary() {
  // Today, in Manila: the job runs at 21:00, the same day it reports on.
  const date = todayIsoDate()
  const { movements, written } = await NotificationService.notifyEndOfDay(date)
  console.log(movements === 0
    ? `  → ${date}: no finished-goods movement — nothing sent`
    : `  → ${date}: ${movements} movement(s); wrote ${written} notification(s)`)
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
      case WRITE_OFF_SUBMITTED:
        return handleWriteOffSubmitted(job)
      case WRITE_OFF_DECIDED:
        return handleWriteOffDecided(job)
      case TRANSFER_SUBMITTED:
        return handleTransferSubmitted(job)
      case TRANSFER_DECIDED:
        return handleTransferDecided(job)
      case TRANSFER_RECEIVED:
        return handleTransferReceived(job)
      case RETURN_SENT:
        return handleReturnSent(job)
      case STOCK_REQUEST_SUBMITTED:
        return handleStockRequestSubmitted(job)
      case STOCK_REQUEST_DECIDED:
        return handleStockRequestDecided(job)
      case LOW_STOCK_CHECK:
        return handleLowStockCheck()
      case STOCK_RECONCILIATION:
        return handleStockReconciliation()
      case EXPIRY_CHECK:
        return handleExpiryCheck()
      case END_OF_DAY_SUMMARY:
        return handleEndOfDaySummary()
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
 * FEATURE 1 (Week 9 Task 2, E4). Throwing hands the job back to BullMQ,
 * which tries again after AI_JOB_OPTIONS' backoff — only for RETRY (busy,
 * unreachable). On the last attempt explain() records the failure itself.
 */
async function handleCostVarianceExplain(job: Job<CostVarianceJob>) {
  const attempts = job.opts.attempts ?? 1
  const outcome = await CostVarianceService.explain(job.data.productionOrderId, {
    userId:      job.data.requestedById,
    lastAttempt: job.attemptsMade + 1 >= attempts,
  })
  console.log(`  → ${outcome} (attempt ${job.attemptsMade + 1} of ${attempts})`)
  if (outcome === 'RETRY') throw new Error('the AI service is busy or unreachable — will retry')
}

/** The weekly waste pattern report (Week 10 Task 2): same retry rule as the explanation. */
async function handleWastePatternReport(job: Job<WastePatternJob>) {
  const attempts = job.opts.attempts ?? 1
  const outcome = await WastePatternService.write(job.data.week, {
    userId:      job.data.requestedById,
    lastAttempt: job.attemptsMade + 1 >= attempts,
  })
  console.log(`  → ${job.data.week} ${outcome} (attempt ${job.attemptsMade + 1} of ${attempts})`)
  if (outcome === 'RETRY') throw new Error('the AI service is busy or unreachable — will retry')
}

/** The Monday clock job: ask for this week's report (queues WASTE_PATTERN_REPORT unless one is already there). */
async function handleWastePatternWeekly() {
  const week = isoWeekKey(todayIsoDate())
  const result = await WastePatternService.request(week, null)
  console.log(`  → ${week} ${result.success ? (result.data.queued ? 'queued' : 'already asked for') : `refused: ${result.error}`}`)
}

/** The monthly supplier report (Week 10 Task 3): same retry rule. */
async function handleSupplierPerformanceReport(job: Job<SupplierPerformanceJob>) {
  const attempts = job.opts.attempts ?? 1
  const outcome = await SupplierPerformanceService.write(job.data.month, {
    userId:      job.data.requestedById,
    lastAttempt: job.attemptsMade + 1 >= attempts,
  })
  console.log(`  → ${job.data.month} ${outcome} (attempt ${job.attemptsMade + 1} of ${attempts})`)
  if (outcome === 'RETRY') throw new Error('the AI service is busy or unreachable — will retry')
}

/** The 1st-of-the-month clock job: ask for the report on the month that just ended. */
async function handleSupplierPerformanceMonthly() {
  const month = lastCompleteMonth()
  const result = await SupplierPerformanceService.request(month, null)
  console.log(`  → ${month} ${result.success ? (result.data.queued ? 'queued' : 'already asked for') : `refused: ${result.error}`}`)
}

/** A reorder explanation (Week 10 Task 4): same retry rule. */
async function handleReorderExplain(job: Job<ReorderJob>) {
  const attempts = job.opts.attempts ?? 1
  const outcome = await ReorderService.explain(job.data.position, {
    userId:      job.data.requestedById,
    lastAttempt: job.attemptsMade + 1 >= attempts,
  })
  console.log(`  → ${job.data.position} ${outcome} (attempt ${job.attemptsMade + 1} of ${attempts})`)
  if (outcome === 'RETRY') throw new Error('the AI service is busy or unreachable — will retry')
}

// A second worker, on its own queue, so a slow Claude call never holds up a
// notification. Two at once: a burst of approvals does not queue up for
// long, and Anthropic's rate limits are far above that.
const aiWorker = new Worker<CostVarianceJob | WastePatternJob | SupplierPerformanceJob | ReorderJob>(
  AI_QUEUE,
  async job => {
    console.log(`[worker:ai] job ${job.id} (${job.name})`)
    switch (job.name) {
      case COST_VARIANCE_EXPLAIN:
        return handleCostVarianceExplain(job as Job<CostVarianceJob>)
      case WASTE_PATTERN_REPORT:
        return handleWastePatternReport(job as Job<WastePatternJob>)
      case WASTE_PATTERN_WEEKLY:
        return handleWastePatternWeekly()
      case SUPPLIER_PERFORMANCE_REPORT:
        return handleSupplierPerformanceReport(job as Job<SupplierPerformanceJob>)
      case SUPPLIER_PERFORMANCE_MONTHLY:
        return handleSupplierPerformanceMonthly()
      case REORDER_EXPLAIN:
        return handleReorderExplain(job as Job<ReorderJob>)
      default:
        throw new Error(`Unknown job name: ${job.name}`)
    }
  },
  { connection: redisConnection, concurrency: 2 },
)

aiWorker.on('completed', job => console.log(`[worker:ai] job ${job.id} completed`))
aiWorker.on('failed', (job, err) => {
  console.error(`[worker:ai] job ${job?.id} FAILED: ${err.message}`)
  // Out of attempts on something explain() did not expect (the database was
  // down, a bug): the insight would stay PENDING and the card spin forever.
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return
  const marked =
    job.name === COST_VARIANCE_EXPLAIN ? CostVarianceService.giveUp((job.data as CostVarianceJob).productionOrderId, 'Could not write the explanation. Try again.')
    : job.name === WASTE_PATTERN_REPORT ? WastePatternService.giveUp((job.data as WastePatternJob).week, 'Could not write the report. Try again.')
    : job.name === SUPPLIER_PERFORMANCE_REPORT ? SupplierPerformanceService.giveUp((job.data as SupplierPerformanceJob).month, 'Could not write the report. Try again.')
    : job.name === REORDER_EXPLAIN ? ReorderService.giveUp((job.data as ReorderJob).position, 'Could not write the explanation. Try again.')
    : null
  marked?.catch(giveUpError => console.error(`[worker:ai] could not mark the insight failed: ${giveUpError.message}`))
})

console.log(`[worker] listening on "${AI_QUEUE}" — 2 at a time`)

/**
 * Registers the clock-driven jobs. upsertJobScheduler keys each schedule by
 * its id (the job name), so every restart replaces the schedule instead of
 * adding another — and a changed pattern takes effect on the next restart.
 * Redis keeps the schedule, so a run falls due even if the worker was down at
 * 06:00; it runs when the worker is back.
 */
async function scheduleDailyJobs() {
  // Daily jobs on the notifications queue; weekly / monthly AI reports on the ai queue (Week 10, P7).
  for (const [queue, jobs] of [[getNotificationQueue(), DAILY_JOBS], [getAiQueue(), AI_SCHEDULED_JOBS]] as const) {
    for (const { name, pattern } of jobs) {
      await queue.upsertJobScheduler(name, { pattern, tz: BUSINESS_TIME_ZONE }, { name, data: {} })
      const next = (await queue.getJobScheduler(name))?.next
      const when = next === undefined
        ? 'unknown'
        : new Date(next).toLocaleString('en-PH', { timeZone: BUSINESS_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
      console.log(`[worker] ${name} scheduled "${pattern}" ${BUSINESS_TIME_ZONE} — next run ${when}`)
    }
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
  await Promise.all([worker.close(), aiWorker.close()])
  await Promise.all([getNotificationQueue().close(), getAiQueue().close()])
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
