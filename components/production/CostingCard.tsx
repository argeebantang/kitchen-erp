import { formatPeso, formatSignedPeso, trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the order page.
import type { CostingDto, RunCostDto } from '@/services/production-order.service'

const KIND_LABEL: Record<CostingDto['kind'], { label: string; className: string }> = {
  ESTIMATE: { label: 'Estimate',              className: 'bg-gray-100 text-gray-600' },
  PENDING:  { label: 'Recorded on approval',  className: 'bg-violet-50 text-violet-700' },
  RECORDED: { label: 'Recorded',              className: 'bg-emerald-50 text-emerald-700' },
}

/**
 * What the run costs (Week 6 Task 3, D7): the BOM at reference prices — on
 * the production date for the plan, on the day it was produced for the batch
 * — per unit of output, and the variance between them. Every figure comes
 * from the server in Decimal; this only formats.
 */
export function CostingCard({ costing }: { costing: CostingDto }) {
  const { kind, unitAbbreviation: unit, plannedQty, planned, actual, variance } = costing
  const kindStyle = KIND_LABEL[kind]
  // The breakdown shows the prices behind the headline figure.
  const shown: RunCostDto = actual ?? planned
  const missing = [...new Set([...planned.missing, ...(actual?.missing ?? [])])]
  // Recorded lines come from the ledger, which keeps the price but not the
  // date it took effect.
  const showSince = shown.lines.some(line => line.priceEffective !== null)

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Costing</p>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${kindStyle.className}`}>{kindStyle.label}</span>
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <CostFigure
          label={kind === 'ESTIMATE' ? 'Estimated cost' : 'Planned cost'}
          run={planned}
          quantity={plannedQty}
          unit={unit}
        />
        {actual && <CostFigure label="Batch cost" run={actual} quantity={actual.yield} unit={unit} />}
        {actual && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Variance</p>
            {variance === null ? (
              <p className="text-gray-400">—</p>
            ) : (
              <>
                <p className={`text-lg font-semibold ${
                  variance.startsWith('-') ? 'text-emerald-700' : Number(variance) === 0 ? 'text-gray-800' : 'text-red-700'
                }`}>
                  {formatSignedPeso(variance)}
                </p>
                <p className="text-xs text-gray-500">
                  {variance.startsWith('-') ? 'under plan' : Number(variance) === 0 ? 'on plan' : 'over plan'} — what{' '}
                  {trimDecimal(actual.yield)} {unit} cost beyond the planned {planned.perUnit === null ? '—' : formatPeso(planned.perUnit)}/{unit}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          No price on record for {missing.join(', ')} on the date used, so the cost cannot be worked out. An admin adds a
          reference price in Master Data (it may be back-dated).
          {kind === 'PENDING' && ' The completion cannot be approved until then.'}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-orange-600 hover:text-orange-700">
          Ingredient costs ({shown.lines.length}) — prices on {shown.pricedOn}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Ingredient</th>
                <th className="py-2 pr-4 text-right font-medium">Quantity</th>
                <th className="py-2 pr-4 text-right font-medium">Price</th>
                {showSince && <th className="py-2 pr-4 font-medium">Price since</th>}
                <th className="py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.lines.map(line => (
                <tr key={line.materialId}>
                  <td className="py-1.5 pr-4 text-gray-700">
                    {line.materialName} <span className="font-mono text-xs text-gray-400">{line.materialCode}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-right text-gray-700">
                    {trimDecimal(line.quantity)} <span className="text-gray-400">{line.unitAbbreviation}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-right text-gray-700">
                    {line.unitPrice === null
                      ? <span className="font-medium text-red-700">No price</span>
                      : <>{formatPeso(line.unitPrice)}<span className="text-gray-400">/{line.unitAbbreviation}</span></>}
                  </td>
                  {showSince && <td className="py-1.5 pr-4 text-gray-500">{line.priceEffective ?? '—'}</td>}
                  <td className="py-1.5 text-right font-medium text-gray-800">{line.cost === null ? '—' : formatPeso(line.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function CostFigure({ label, run, quantity, unit }: { label: string; run: RunCostDto; quantity: string; unit: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-800">{run.total === null ? '—' : formatPeso(run.total)}</p>
      <p className="text-xs text-gray-500">
        {run.perUnit === null ? 'incomplete' : <>{formatPeso(run.perUnit)}/{unit}</>}
        {' '}for {trimDecimal(quantity)} {unit}
        {' '}· prices on {run.pricedOn}
      </p>
    </div>
  )
}
