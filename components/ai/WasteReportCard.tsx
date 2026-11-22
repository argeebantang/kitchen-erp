import { shortDateLabel } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the dashboard.
import type { WasteDashboardDto, WasteFacts, WasteFinding } from '@/services/waste-pattern.service'
import { AiInsightPanel } from '@/components/ai/AiInsightPanel'

const PRIORITY_STYLES: Record<WasteFinding['priority'], string> = {
  high:   'border-red-200 bg-red-50 text-red-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low:    'border-gray-200 bg-gray-50 text-gray-600',
}

function signedPct(value: string | null): string {
  if (value === null) return 'new'
  return value.startsWith('-') ? `−${value.slice(1)}%` : `+${value}%`
}

/** One figure a finding rests on, as the code worked it out — so the text can be checked against it. */
function figureLabel(facts: WasteFacts, id: string): string | null {
  const row = facts.rows.find(r => r.id === id)
  if (row) {
    return `${row.branch} · ${row.good}: ${trimDecimal(row.writtenOffKg)} ${row.unit} written off (${formatPeso(row.writtenOffValue)})`
      + (row.wastePctOfCameIn ? `, ${row.wastePctOfCameIn}% of what came in` : '')
  }
  const route = facts.routes.find(r => r.id === id)
  if (route) return `${route.route}: ${route.deliveriesWithLoss} of ${route.deliveries} deliveries short, ${formatPeso(route.lostValue)}`
  const recovered = facts.recovered.find(r => r.id === id)
  if (recovered) return `${recovered.kitchen}: ${trimDecimal(recovered.convertedKg)} kg ${recovered.from} made into ${trimDecimal(recovered.madeKg)} kg ${recovered.into}`
  return null
}

/**
 * Dashboard → KitchenAI insights → Waste (Week 10 Task 2, Feature 3): the last
 * 30 days of waste as the code works it out, and Claude's findings about it.
 * Every finding shows the figures it rests on (W / T / C rows), so the text
 * can be checked against them.
 */
export function WasteReportCard({ data, canGenerate }: { data: WasteDashboardDto; canGenerate: boolean }) {
  const { facts, insight, report } = data
  const { totals } = facts

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-800">Waste — last {facts.days} days</h3>
        <p className="text-xs text-gray-400">
          {shortDateLabel(facts.from)} – {shortDateLabel(facts.to)} · report {facts.week}
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Lost</p>
          <p className="text-lg font-semibold text-red-700">{formatPeso(totals.lostValue)}</p>
          <p className="text-xs text-gray-500">
            {totals.lostPctOfProductionCost ? `${totals.lostPctOfProductionCost}% of ${formatPeso(totals.productionCost)} produced` : 'nothing produced'}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Written off</p>
          <p className="text-lg font-semibold text-gray-800">{formatPeso(totals.writtenOffValue)}</p>
          <p className="text-xs text-gray-500">
            {trimDecimal(totals.writtenOffKg)} kg · {signedPct(totals.writtenOffChangePct)} vs the 30 days before
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Lost in transit</p>
          <p className="text-lg font-semibold text-gray-800">{formatPeso(totals.lostInTransitValue)}</p>
          <p className="text-xs text-gray-500">
            {facts.recovered.length > 0
              ? `Recovered: ${facts.recovered.reduce((n, r) => n + r.conversions, 0)} conversions`
              : 'No conversions'}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-3">
        <AiInsightPanel
          insight={insight}
          type="WASTE_PATTERN"
          referenceId={data.week}
          canGenerate={canGenerate}
          title="Waste patterns"
          empty="No report for this week yet — one is written every Monday at 06:00."
          firstLabel="Generate this week's report"
          writing="Claude is reading 30 days of waste…"
          checkHint="Each finding shows the figures it rests on."
          costHint="About 2 cents."
        >
          {report && (
            <div className="space-y-3">
              <p className="text-sm text-gray-800">{report.summary}</p>
              {report.findings.length === 0 && <p className="text-sm text-gray-500">No pattern worth acting on.</p>}
              <ol className="space-y-2">
                {report.findings.map((finding, index) => (
                  <li key={index} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[finding.priority]}`}>{finding.priority}</span>
                      <span className="text-sm font-semibold text-gray-800">{finding.title}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700">{finding.pattern}</p>
                    <p className="mt-1 text-sm text-gray-800"><span className="font-medium text-purple-700">Do:</span> {finding.recommendation}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {finding.figureIds.map(id => (
                        <li key={id} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          <span className="font-mono text-gray-400">{id}</span> {figureLabel(facts, id)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </AiInsightPanel>
      </div>

      <details className="mt-4" open>
        <summary className="cursor-pointer text-sm font-medium text-gray-700">The figures (worked out by the system)</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-3 font-medium">Where · what</th>
                <th className="py-1.5 pr-3 text-right font-medium">Written off</th>
                <th className="py-1.5 pr-3 font-medium">Why</th>
                <th className="py-1.5 pr-3 text-right font-medium">Days</th>
                <th className="py-1.5 pr-3 text-right font-medium">Of what came in</th>
                <th className="py-1.5 pr-3 text-right font-medium">Sold / in (outlets)</th>
                <th className="py-1.5 text-right font-medium">vs before</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {facts.rows.map(row => (
                <tr key={row.id} className="align-top">
                  <td className="py-1.5 pr-2 font-mono text-xs text-gray-400">{row.id}</td>
                  <td className="py-1.5 pr-3 text-gray-800">{row.branch} · {row.good}</td>
                  <td className="py-1.5 pr-3 text-right text-gray-800">
                    {trimDecimal(row.writtenOffKg)} {row.unit}<span className="block text-xs text-gray-500">{formatPeso(row.writtenOffValue)}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-gray-600">
                    {Object.entries(row.byReason).map(([reason, value]) => `${reason} ${trimDecimal(value)}`).join(' · ')}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-gray-600">{row.daysWithWriteOffs}</td>
                  <td className="py-1.5 pr-3 text-right text-gray-600">{row.wastePctOfCameIn === null ? '—' : `${row.wastePctOfCameIn}%`}</td>
                  <td className="py-1.5 pr-3 text-right text-gray-600">
                    {row.soldKg === null ? '—' : `${trimDecimal(row.soldKg)} / ${trimDecimal(row.cameInKg)} ${row.unit}`}
                  </td>
                  <td className="py-1.5 text-right text-gray-600">{signedPct(row.changePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {facts.otherRows > 0 && <p className="mt-1 text-xs text-gray-400">…and {facts.otherRows} smaller ones.</p>}

          {facts.routes.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Lost in transit</p>
              <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                {facts.routes.map(route => (
                  <li key={route.id}>
                    <span className="font-mono text-xs text-gray-400">{route.id}</span> {route.route}: {route.deliveriesWithLoss} of {route.deliveries} deliveries short, {trimDecimal(route.lostKg)} kg, {formatPeso(route.lostValue)}
                    {route.reasons.length > 0 && <span className="text-gray-500"> ({route.reasons.join(', ')})</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {facts.recovered.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Recovered by conversion</p>
              <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                {facts.recovered.map(row => (
                  <li key={row.id}>
                    <span className="font-mono text-xs text-gray-400">{row.id}</span> {row.kitchen}: {trimDecimal(row.convertedKg)} kg {row.from} → {trimDecimal(row.madeKg)} kg {row.into} ({row.conversions} conversions)
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </section>
  )
}
