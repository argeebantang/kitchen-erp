import type { AiCallOutcome } from '@prisma/client'
import type { AiCallDto } from '@/services/ai.service'
import { formatDateTime } from '@/lib/dates'
import { formatUsd } from '@/lib/format'

const OUTCOME_BADGES: Record<AiCallOutcome, { label: string; className: string }> = {
  COMPLETED:   { label: 'Completed',   className: 'bg-emerald-50 text-emerald-700' },
  REFUSED:     { label: 'Refused',     className: 'bg-amber-50 text-amber-700' },
  MAX_TOKENS:  { label: 'Cut off',     className: 'bg-amber-50 text-amber-700' },
  ERROR:       { label: 'Error',       className: 'bg-red-50 text-red-700' },
  OVER_BUDGET: { label: 'Over budget', className: 'bg-gray-100 text-gray-600' },
}

function tokens(value: number): string {
  return value.toLocaleString('en-PH')
}

/** The newest Claude API calls on AI Settings (Week 9 Task 1, D10): what each cost and how it ended. */
export function RecentAiCalls({ calls }: { calls: AiCallDto[] }) {
  if (calls.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-gray-400">No AI calls yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th className="px-5 py-2 font-medium">When</th>
            <th className="px-5 py-2 font-medium">Feature</th>
            <th className="px-5 py-2 font-medium">Who</th>
            <th className="px-5 py-2 font-medium">Outcome</th>
            <th className="px-5 py-2 font-medium">Model</th>
            <th className="px-5 py-2 text-right font-medium">Tokens in / out</th>
            <th className="px-5 py-2 text-right font-medium">Time</th>
            <th className="px-5 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {calls.map(call => {
            const badge = OUTCOME_BADGES[call.outcome]
            const cached = call.cacheReadTokens + call.cacheWriteTokens
            return (
              <tr key={call.id} className="align-top">
                <td className="whitespace-nowrap px-5 py-2 text-gray-600">{formatDateTime(call.createdAt)}</td>
                <td className="px-5 py-2 text-gray-800">{call.featureLabel}</td>
                <td className="px-5 py-2 text-gray-600">{call.userName ?? <span className="text-gray-400">Background job</span>}</td>
                <td className="px-5 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                  {call.errorType && <p className="mt-1 text-xs text-gray-400">{call.errorType}</p>}
                </td>
                <td className="px-5 py-2 font-mono text-xs text-gray-600">
                  {call.model}
                  {call.fallbackModel && <p className="mt-1 text-amber-700">answered by {call.fallbackModel}</p>}
                </td>
                <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-gray-600">
                  {tokens(call.inputTokens)} / {tokens(call.outputTokens)}
                  {cached > 0 && (
                    <p className="text-xs text-gray-400">cache {tokens(call.cacheReadTokens)} read · {tokens(call.cacheWriteTokens)} written</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-gray-600">{(call.durationMs / 1000).toFixed(1)} s</td>
                <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-gray-800">{formatUsd(call.costUsd, 4)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
