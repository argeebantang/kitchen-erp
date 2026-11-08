import { Check, X } from 'lucide-react'
import { BUSINESS_TIME_ZONE } from '@/lib/dates'
// Type-only: this renders on the server, for the order page.
import type { ProductionOrderDetailDto } from '@/services/production-order.service'

/** The happy path, in order (Week 5 Task 6, D6). */
const STEPS = [
  { status: 'DRAFT',            label: 'Draft' },
  { status: 'PENDING_APPROVAL', label: 'Pending approval' },
  { status: 'APPROVED',         label: 'Approved' },
  { status: 'IN_PROGRESS',      label: 'In progress' },
  { status: 'COMPLETED',        label: 'Completed' },
] as const

const ENDINGS: Record<string, string> = { REJECTED: 'Rejected', CANCELLED: 'Cancelled' }

type Step = { label: string; state: 'done' | 'current' | 'todo' | 'ended'; who?: string; at?: string; note?: string | null }

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: BUSINESS_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
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
  const endingLabel = ENDINGS[order.status]
  const ending      = endingLabel ? changeTo(order.status) : undefined
  // Where the happy path stops: the current status, or for a rejected or
  // cancelled order the status it left (a rejection always leaves pending).
  const reached = ending?.fromStatus ?? (order.status === 'REJECTED' ? 'PENDING_APPROVAL' : order.status)
  const reachedIndex = Math.max(STEPS.findIndex(step => step.status === reached), 0)
  const visible = endingLabel ? STEPS.slice(0, reachedIndex + 1) : STEPS

  const steps: Step[] = visible.map((step, index) => {
    const state: Step['state'] = endingLabel || index < reachedIndex ? 'done' : index === reachedIndex ? 'current' : 'todo'
    if (index === 0) {
      return { label: step.label, state, who: order.requestedByName, at: order.createdAt }
    }
    const change = changeTo(step.status)
    return {
      label: step.label,
      state,
      // An order submitted before the log existed has no row for it; the
      // order row still knows who submitted.
      who:   change?.changedByName ?? (step.status === 'PENDING_APPROVAL' ? order.submittedByName ?? undefined : undefined),
      at:    change?.at,
      note:  step.status === 'APPROVED' ? change?.note : undefined,
    }
  })

  if (endingLabel) {
    steps.push({ label: endingLabel, state: 'ended', who: ending?.changedByName, at: ending?.at, note: ending?.note })
  }

  // D4: no rule against starting early, but the record says so.
  const started = changeTo('IN_PROGRESS')
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
                  {step.who}{step.who && step.at && ' · '}{step.at && formatAt(step.at)}
                </p>
              )}
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
