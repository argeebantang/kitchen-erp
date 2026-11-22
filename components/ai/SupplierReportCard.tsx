import { monthLabel, shortDateLabel } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the dashboard.
import type { SupplierDashboardDto, SupplierFacts } from '@/services/supplier-performance.service'
import type { AiFinding } from '@/services/ai-findings'
import { AiInsightPanel } from '@/components/ai/AiInsightPanel'
import { inputClass, secondaryButtonClass } from '@/components/ui/form'

const PRIORITY_STYLES: Record<AiFinding['priority'], string> = {
  high:   'border-red-200 bg-red-50 text-red-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low:    'border-gray-200 bg-gray-50 text-gray-600',
}

/** One figure a finding rests on, as the code worked it out. */
function figureLabel(facts: SupplierFacts, id: string): string | null {
  const supplier = facts.suppliers.find(s => s.id === id)
  if (supplier) {
    return `${supplier.supplier}: short on ${supplier.shortDeliveries} of ${supplier.deliveries} deliveries, late on ${supplier.ordersLate} of ${supplier.ordersDelivered} orders`
  }
  const material = facts.materials.find(m => m.id === id)
  if (material) return `${material.supplier} · ${material.material}: short on ${material.shortLines} of ${material.lines} lines (${formatPeso(material.shortValue)})`
  return null
}

/**
 * Dashboard → KitchenAI insights → Suppliers (Week 10 Task 3, Feature 6): one
 * month of deliveries per supplier as the code works it out — the flags come
 * from the rule, not from Claude — and Claude's findings about it.
 */
export function SupplierReportCard({ data, canGenerate }: { data: SupplierDashboardDto; canGenerate: boolean }) {
  const { facts, insight, report, supplier } = data
  const { totals } = facts

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-800">
            Suppliers — {monthLabel(data.month)}{supplier && <span className="text-purple-700"> · {supplier.name}</span>}
          </h3>
          <p className="text-xs text-gray-400">{shortDateLabel(facts.from)} – {shortDateLabel(facts.to)} · deliveries received that month</p>
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <select name="supplierMonth" defaultValue={data.month} className={inputClass} aria-label="Month">
              {data.monthOptions.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </div>
          <div className="w-56">
            <select name="supplier" defaultValue={supplier?.name ?? ''} className={inputClass} aria-label="Supplier">
              <option value="">All suppliers</option>
              {data.supplierOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <button type="submit" className={secondaryButtonClass}>Show</button>
        </form>
      </div>

      {!supplier && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Received</p>
            <p className="text-lg font-semibold text-gray-800">{formatPeso(totals.receivedValue)}</p>
            <p className="text-xs text-gray-500">{totals.deliveries} deliveries from {totals.suppliers} suppliers</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Short-delivered</p>
            <p className="text-lg font-semibold text-red-700">{formatPeso(totals.shortValue)}</p>
            <p className="text-xs text-gray-500">{formatPeso(totals.rejectedValue)} rejected · {formatPeso(totals.unfilledValue)} still unfilled</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Flagged</p>
            <p className={`text-lg font-semibold ${totals.flaggedSuppliers > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {totals.flaggedSuppliers} of {totals.suppliers} suppliers
            </p>
            <p className="text-xs text-gray-500">short or late on a quarter of their deliveries</p>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1.5 pr-2 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">Supplier</th>
              <th className="py-1.5 pr-3 text-right font-medium">Received</th>
              <th className="py-1.5 pr-3 text-right font-medium">Short deliveries</th>
              <th className="py-1.5 pr-3 text-right font-medium">Rejected</th>
              <th className="py-1.5 pr-3 text-right font-medium">Late orders</th>
              <th className="py-1.5 pr-3 text-right font-medium">Lead time</th>
              <th className="py-1.5 text-right font-medium">Unfilled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {facts.suppliers.map(row => (
              <tr key={row.id} className="align-top">
                <td className="py-1.5 pr-2 font-mono text-xs text-gray-400">{row.id}</td>
                <td className="py-1.5 pr-3 text-gray-800">
                  {row.supplier}
                  {row.flags.map(flag => (
                    <span key={flag} className="ml-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">{flag}</span>
                  ))}
                  {row.flagReasons.length > 0 && <span className="block text-xs text-red-700">{row.flagReasons.join(' · ')}</span>}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-700">{formatPeso(row.receivedValue)}<span className="block text-xs text-gray-400">{row.deliveries} deliveries</span></td>
                <td className="py-1.5 pr-3 text-right text-gray-700">
                  {row.shortDeliveries} of {row.deliveries}{row.shortDeliveryPct && <span className="text-gray-400"> ({row.shortDeliveryPct}%)</span>}
                  <span className="block text-xs text-gray-500">{formatPeso(row.shortValue)} missing</span>
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-700">{row.rejectedLines} lines<span className="block text-xs text-gray-500">{formatPeso(row.rejectedValue)}</span></td>
                <td className="py-1.5 pr-3 text-right text-gray-700">
                  {row.ordersLate} of {row.ordersDelivered}{row.lateOrderPct && <span className="text-gray-400"> ({row.lateOrderPct}%)</span>}
                  {row.avgDaysLate && <span className="block text-xs text-gray-500">{row.avgDaysLate} days on average</span>}
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-700">
                  {row.measuredLeadTimeDays ?? '—'} d<span className="block text-xs text-gray-500">promised {row.promisedLeadTimeDays ?? '—'}</span>
                </td>
                <td className="py-1.5 text-right text-gray-700">{row.unfilledOrders} orders<span className="block text-xs text-gray-500">{formatPeso(row.unfilledValue)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {facts.suppliers.length === 0 && <p className="mt-2 text-sm text-gray-500">No deliveries were received this month.</p>}

        {facts.materials.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Materials that came short</p>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
              {facts.materials.map(m => (
                <li key={m.id}>
                  <span className="font-mono text-xs text-gray-400">{m.id}</span> {m.supplier} · {m.material}: short on {m.shortLines} of {m.lines} lines, {trimDecimal(m.shortQty)} {m.unit} ({formatPeso(m.shortValue)})
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-xs text-gray-400">{facts.flagRule}</p>
      </div>

      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-3">
        <AiInsightPanel
          insight={insight}
          type="SUPPLIER_PERFORMANCE"
          referenceId={data.month}
          canGenerate={canGenerate}
          title="Supplier review"
          empty="No review for this month yet — one is written on the 1st of every month at 06:00."
          firstLabel={`Review ${monthLabel(data.month)}`}
          writing="Claude is reviewing the month's deliveries…"
          checkHint="Each finding shows the figures it rests on."
          costHint="About 2 cents."
        >
          {report && (
            <div className="space-y-3">
              <p className="text-sm text-gray-800">{supplier && <span className="font-medium">All suppliers: </span>}{report.summary}</p>
              {supplier && (
                <p className="text-xs text-gray-500">
                  {report.findings.length === 0
                    ? `None of the month's ${data.totalFindings} findings is about ${supplier.name}.`
                    : `${report.findings.length} of ${data.totalFindings} findings are about ${supplier.name}.`}
                </p>
              )}
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
                          <span className="font-mono text-gray-400">{id}</span> {figureLabel(facts, id) ?? 'another supplier'}
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
    </section>
  )
}
