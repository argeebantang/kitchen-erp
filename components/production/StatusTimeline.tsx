import { Check, X } from 'lucide-react'
import { BUSINESS_TIME_ZONE, formatDateTime } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
// Type-only: this renders on the server, for the order page.
import type { ProductionOrderDetailDto } from '@/services/production-order.service'

/**
 * The happy path, in order (Week 5 Task 6, D6). "Completion pending" is the
 * kitchen's report awaiting accounting's sign-off (Week 6 Task 1).
 */
const STEPS = [
  { status: 'DRAFT',              label: 'Draft' },
  { status: 'PENDING_APPROVAL',   label: 'Pending approval' },
  { status: 'APPROVED',           label: 'Approved' },
  { status: 'IN_PROGRESS',        label: 'In progress' },
  { status: 'PENDING_COMPLETION', label: 'Completion pending' },
  { status: 'COMPLETED',          label: 'Completed' },
] as const

const ENDINGS: Record<string, string> = { REJECTED: 'Rejected', CANCELLED: 'Cancelled' }

type Step = {
  label: string
  state: 'done' | 'current' | 'todo' | 'ended'
  who?: string
  at?: string
  /** Someone's words — remarks or a reason — shown in quotes. */
  note?: string | null
  /** A figure the step recorded, e.g. the reported yield; shown plainly. */
  detail?: string
}

/**
 * Where the order is in its life and who moved it at each step, from the
 * status log (ProductionStatusChange). "Draft" comes from the order row —
 * creation is not logged. A rejected or cancelled order ends in red after the
 * last step it reached, with the remarks or reason; the steps it never
 * reached are not drawn.
 *
 * Server Component: no state, dates formatted in the kitchen's timezone.
 */
export function StatusTimeline({ order }: { order: ProductionOrderDetailDto }) {
  // The latest log row into a status (a status is only entered once today,
  // but latest is the right reading if that ever changes).
  const changeTo = (status: string) => [...order.statusChanges].reverse().find(change => change.toStatus === status)
  // A completion accounting sent back also moves the order into IN_PROGRESS
  // (Week 6 Task 2, D4), so the run's start is the change out of APPROVED,
  // and the latest send-back is shown on that step as what happened since.
  const started  = order.statusChanges.find(change => change.fromStatus === 'APPROVED' && change.toStatus === 'IN_PROGRESS')
  const sentBack = [...order.statusChanges].reverse()
    .find(change => change.fromStatus === 'PENDING_COMPLETION' && change.toStatus === 'IN_PROGRESS')
  const entered  = (status: string) => (status === 'IN_PROGRESS' ? started : changeTo(status))
  const endingLabel = ENDINGS[order.status]
  const ending      = endingLabel ? changeTo(order.status) : undefined
  // Where the happy path stops: the current status, or for a rejected or
  // cancelled order the status it left (a rejection always leaves pending).
  const reached = ending?.fromStatus ?? (order.status === 'REJECTED' ? 'PENDING_APPROVAL' : order.status)
  const reachedIndex = Math.max(STEPS.findIndex(step => step.status === reached), 0)
  const visible = endingLabel ? STEPS.slice(0, reachedIndex + 1) : STEPS

  const steps: Step[] = visible.map((step, index) => {
    // COMPLETED is the end of the happy path: nothing is current any more.
    const finished = endingLabel !== undefined || order.status === 'COMPLETED'
    const state: Step['state'] = finished || index < reachedIndex ? 'done' : index === reachedIndex ? 'current' : 'todo'
    if (index === 0) {
      return { label: step.label, state, who: order.requestedByName, at: order.createdAt }
    }
    // Not reached yet. After a send-back, "Completion pending" has a log row
    // from the rejected report; it belongs to the past, not to this step now.
    if (state === 'todo') return { label: step.label, state }
    const change = entered(step.status)
    return {
      label: step.label,
      state,
      // An order submitted before the log existed has no row for it; the
      // order row still knows who submitted.
      who:   change?.changedByName ?? (step.status === 'PENDING_APPROVAL' ? order.submittedByName ?? undefined : undefined),
      at:    change?.at,
      // Accounting's remarks on its two approvals: the plan and the completion.
      note:  step.status === 'APPROVED' || step.status === 'COMPLETED'
        ? change?.note
        : step.status === 'IN_PROGRESS' ? sentBack?.note : undefined,
      // The order holds the latest report (Week 6 Task 1, D5).
      detail: step.status === 'PENDING_COMPLETION' && order.actualYield
        ? `Yield ${trimDecimal(order.actualYield.actualQty)} ${order.unitAbbreviation} of ${trimDecimal(order.plannedQty)} ${order.unitAbbreviation} planned`
        : step.status === 'IN_PROGRESS' && sentBack
          ? `Completion sent back by ${sentBack.changedByName} · ${formatDateTime(sentBack.at)}`
          : undefined,
    }
  })

  if (endingLabel) {
    steps.push({ label: endingLabel, state: 'ended', who: ending?.changedByName, at: ending?.at, note: ending?.note })
  }

  // D4: no rule against starting early, but the record says so.
  const startedDay = started
    ? new Date(started.at).toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE })
    : null
  const startedEarly = startedDay !== null && startedDay < order.plannedDate

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <ol className="flex flex-wrap gap-y-4">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-36 flex-1 items-start gap-2">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.state === 'done'    ? 'bg-emerald-500 text-white'
                : step.state === 'current' ? 'bg-orange-500 text-white ring-4 ring-orange-100'
                : step.state === 'ended'   ? 'bg-red-500 text-white'
                : 'bg-gray-100 text-gray-400'
              }`}
            >
              {step.state === 'done' ? <Check size={14} /> : step.state === 'ended' ? <X size={14} /> : index + 1}
            </span>
            <div className="min-w-0 pr-3 text-sm">
              <p className={`font-medium ${
                step.state === 'todo' ? 'text-gray-400' : step.state === 'ended' ? 'text-red-700' : 'text-gray-800'
              }`}>
                {step.label}
              </p>
              {(step.who || step.at) && (
                <p className="text-xs text-gray-500">
                  {step.who}{step.who && step.at && ' · '}{step.at && formatDateTime(step.at)}
                </p>
              )}
              {step.detail && <p className="mt-0.5 text-xs text-gray-600">{step.detail}</p>}
              {step.note && <p className="mt-0.5 text-xs text-gray-600">“{step.note}”</p>}
            </div>
          </li>
        ))}
      </ol>
      {startedEarly && (
        <p className="mt-3 text-xs text-amber-700">
          Started on {startedDay}, before its production date ({order.plannedDate}).
        </p>
      )}
    </div>
  )
}
