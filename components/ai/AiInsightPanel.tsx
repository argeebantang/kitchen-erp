import { formatDateTime } from '@/lib/dates'
import { formatUsd } from '@/lib/format'
// Type-only: rendered on the server.
import type { AiInsightDto } from '@/services/ai.service'
import { AiBadge } from '@/components/ai/AiBadge'
import { InsightRequestButton } from '@/components/ai/InsightRequestButton'

/**
 * An AI insight in whichever state it is (Week 10 Task 2), the same for every
 * feature. The feature renders only the written content (`children`); the
 * panel handles the rest:
 *   none          "{empty}" + the first-time button
 *   being written spinner (the page polls with AutoRefresh while PENDING)
 *   failed        the reason + Try again
 *   written       the content, when / which model / what it cost, Regenerate
 *   regenerating  the earlier content, dimmed, with "writing a new one…"
 *   regenerate failed  the earlier content + why the new one could not be written
 * Buttons only for roles that may ask (AiInsightService.canGenerate).
 */
export function AiInsightPanel({ insight, type, referenceId, canGenerate, title, empty, firstLabel, writing, checkHint, costHint, children }: {
  insight: AiInsightDto | null
  type: string
  referenceId: string
  canGenerate: boolean
  title: string
  /** Shown when there is none yet. */
  empty: string
  /** The first-time button, e.g. "Explain this batch". */
  firstLabel: string
  /** Shown while it is written, e.g. "Claude is explaining this batch…". */
  writing: string
  /** The footer's reminder to check the text against the figures. */
  checkHint?: string
  /** Beside the first-time button, e.g. "Costs less than a cent." */
  costHint?: string
  children?: React.ReactNode
}) {
  const header = (
    <p className="flex items-center gap-2 text-xs font-medium text-purple-700">
      <AiBadge /> {title}
    </p>
  )

  if (insight === null) {
    return (
      <div>
        {header}
        <p className="mt-1 text-sm text-gray-400">{empty}</p>
        {canGenerate && <div className="mt-2"><InsightRequestButton type={type} referenceId={referenceId} label={firstLabel} note={costHint} /></div>}
      </div>
    )
  }

  if (insight.status === 'PENDING' && !insight.regenerating) {
    return (
      <div>
        {header}
        <Writing text={writing} />
      </div>
    )
  }

  if (insight.status === 'FAILED') {
    return (
      <div>
        {header}
        <p className="mt-1 text-sm text-red-700">Could not write it: {insight.error ?? 'unknown error'}</p>
        {canGenerate && <div className="mt-2"><InsightRequestButton type={type} referenceId={referenceId} label="Try again" /></div>}
      </div>
    )
  }

  // Written — or being rewritten, with the earlier text still shown.
  return (
    <div>
      {header}
      {insight.regenerating && <Writing text="Writing a new one — the earlier version stays until it is ready…" />}
      {insight.status === 'READY' && insight.error && (
        <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Regenerate could not be written: {insight.error} The earlier version is shown.
        </p>
      )}
      <div className={`mt-1 ${insight.regenerating ? 'opacity-50' : ''}`}>{children}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        <span>
          {insight.generatedAt && <>Written {formatDateTime(insight.generatedAt)}</>}
          {insight.model && <> by <span className="font-mono">{insight.model}</span></>}
          {insight.costUsd && <> · {formatUsd(insight.costUsd, 4)}</>}
          {checkHint && <> · {checkHint}</>}
        </span>
        {canGenerate && !insight.regenerating && <InsightRequestButton type={type} referenceId={referenceId} label="Regenerate" regenerate />}
      </div>
    </div>
  )
}

function Writing({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-center gap-2 text-sm text-purple-700">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-700" aria-hidden="true" />
      {text}
    </p>
  )
}
