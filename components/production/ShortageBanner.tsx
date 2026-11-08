import { AlertTriangle, CheckCircle2, ShoppingCart } from 'lucide-react'
import Link from 'next/link'
import { trimDecimal } from '@/lib/format'
// Type-only, like MaterialRequirementsTable: rendered on the order page
// (server) and inside ProductionOrderForm (client).
import type { MaterialRequirementDto } from '@/services/production-order.service'

/**
 * The shortage alert (Week 5 Task 4): names every ingredient the branch cannot
 * cover and by how much, above the requirements table, so a shortage cannot
 * hide in row 9 of 14. Built only from the stock check the lines already
 * carry; renders nothing where there is no check (a completed, rejected or
 * cancelled order).
 */
export function ShortageBanner({
  lines, branchName, requestHref,
}: {
  lines: MaterialRequirementDto[]
  branchName: string
  /**
   * The order page's "Request missing materials" target, shown on the red
   * banner only. Omitted in the form: an unsaved order has nothing to link.
   */
  requestHref?: string
}) {
  if (!lines.some(line => line.stock !== null)) return null

  const short = lines.flatMap(line =>
    line.stock && !line.stock.enough ? [{ line, short: line.stock.short }] : [],
  )

  if (short.length === 0) {
    return (
      <p className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 size={16} className="shrink-0" />
        {lines.length === 1 ? 'The only ingredient is' : `All ${lines.length} ingredients are`} in stock at {branchName}.
      </p>
    )
  }

  return (
    <div className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Short on {short.length} of {lines.length} {lines.length === 1 ? 'ingredient' : 'ingredients'} at {branchName}
        </p>
        {/* One chip per ingredient in a wrapping flex row: each keeps its own box,
            so a long name breaks onto the next line instead of running into its
            neighbour, as nowrap spans in running text did. */}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {short.map(({ line, short: amount }) => (
            <li key={line.materialId} className="rounded-md bg-white px-2 py-0.5 text-xs ring-1 ring-red-200">
              {line.materialName}{' '}
              <span className="whitespace-nowrap font-semibold">{trimDecimal(amount)} {line.unitAbbreviation}</span>
            </li>
          ))}
        </ul>
      </div>
      {requestHref && (
        <Link
          href={requestHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          <ShoppingCart size={15} />
          Request missing materials
        </Link>
      )}
    </div>
  )
}
