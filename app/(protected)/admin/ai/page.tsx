import Link from 'next/link'
import { AiService, LATEST_AI_CALLS, TEST_MESSAGE_MAX } from '@/services/ai.service'
import { shortDateLabel } from '@/lib/dates'
import { formatUsd } from '@/lib/format'
import { RecentAiCalls } from '@/components/ai/RecentAiCalls'
import { TestConnection } from '@/components/ai/TestConnection'

/** The bar turns amber from here, so the budget running out is not a surprise. */
const BUDGET_WARNING_PERCENT = 80

/**
 * AI Settings (Week 9 Task 1, D10): whether Claude is set up, what each AI
 * feature asks of it, and what it has cost this month against the budget.
 * ADMIN only — the /admin guard in middleware.
 */
export default async function AiSettingsPage() {
  const overview = await AiService.overview()
  const percent = overview.budgetUsedPercent
  const barColour = percent >= 100 ? 'bg-red-500' : percent >= BUDGET_WARNING_PERCENT ? 'bg-amber-500' : 'bg-orange-500'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">AI Settings</h1>
        <p className="mt-1 text-sm text-gray-400">
          The Claude API connection behind the KitchenAI features, the model each one uses, and what they cost
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700">Connection</h2>
          {overview.configured ? (
            <>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">API key set</span>
              </p>
              <p className="mt-2 text-sm text-gray-500">
                The key is read from <code className="text-gray-700">ANTHROPIC_API_KEY</code> on the server and never shown.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not set up</span>
              </p>
              <p className="mt-2 text-sm text-gray-500">
                AI features are off until <code className="text-gray-700">ANTHROPIC_API_KEY</code> is added to <code className="text-gray-700">.env</code>.
                Restart <code className="text-gray-700">npm run dev</code> and <code className="text-gray-700">npm run worker</code> afterwards.
              </p>
            </>
          )}
          <TestConnection maxLength={TEST_MESSAGE_MAX} />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700">Spending since {shortDateLabel(overview.monthStart)}</h2>
          <p className="mt-3 text-2xl font-bold text-gray-800">
            {formatUsd(overview.spentThisMonthUsd)}
            <span className="ml-1 text-sm font-normal text-gray-400">of {formatUsd(overview.monthlyBudgetUsd)} budget · {percent}%</span>
          </p>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"
            role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Budget used"
          >
            <div className={`h-full ${barColour}`} style={{ width: `${percent}%` }} />
          </div>
          {percent >= 100 && (
            <p className="mt-3 text-sm font-medium text-red-700">The budget is used up: AI features are paused until next month.</p>
          )}
          <p className="mt-3 text-sm text-gray-500">
            Estimated from each call&apos;s tokens. When it reaches the budget (<code className="text-gray-700">AI_MONTHLY_BUDGET_USD</code>),
            AI features stop until next month. The hard limit is the spend limit on the Anthropic Console workspace.
          </p>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">Features</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-5 py-2 font-medium">Feature</th>
                <th className="px-5 py-2 font-medium">Model</th>
                <th className="px-5 py-2 font-medium">Effort</th>
                <th className="px-5 py-2 text-right font-medium">Max tokens</th>
                <th className="px-5 py-2 text-right font-medium">Calls this month</th>
                <th className="px-5 py-2 text-right font-medium">Spent this month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overview.features.map(feature => (
                <tr key={feature.feature}>
                  <td className="px-5 py-2 text-gray-800">{feature.label}</td>
                  <td className="px-5 py-2 font-mono text-xs text-gray-600">{feature.model}</td>
                  <td className="px-5 py-2 text-gray-600">{feature.effort}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-gray-600">{feature.maxTokens.toLocaleString('en-PH')}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-gray-600">{feature.calls}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-gray-800">{formatUsd(feature.spentUsd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Latest {LATEST_AI_CALLS} calls</h2>
          {/* Week 9 Task 4 (H7): the assistant's query log. */}
          <Link href="/admin/ai/questions" className="text-sm text-orange-600 hover:underline">Assistant questions →</Link>
        </div>
        <RecentAiCalls calls={overview.latestCalls} />
      </section>
    </div>
  )
}
