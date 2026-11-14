import { formatDateTime } from '@/lib/dates'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { formatPeso, formatQuantity, formatShelfLife } from '@/lib/format'
// Type-only, so this renders both in the (client) conversion form and on the
// (server) order page without pulling the service into the browser.
import type { ConversionEffectDto } from '@/services/conversion-order.service'

/**
 * What a conversion does to the books (Week 7 Task 1): the source taken from
 * its lots soonest expiry first, expired lots skipped (D6); the added
 * ingredients out of material stock, which may go negative (D5); and the
 * output in as a new lot with its expiry (D8). No hooks, so it works in the
 * form's live preview and on the order page alike. Quantities are rounded to
 * the gram for display: the recipe is scaled by kg used ÷ kg per batch, which
 * rarely divides evenly.
 */
export function ConversionEffect({ effect, title, lotLabel }: {
  effect: ConversionEffectDto
  title: string
  /** How the output lot is named: its number once known, else "a new lot". */
  lotLabel: string
}) {
  const { source, ingredients, negativeCount, output, cost } = effect
  const unit = source.unitAbbreviation
  const hasExpired = Number(source.expiredOnHand) > 0
  const hasPending = Number(source.pending) > 0

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-800">{title}</p>

      {/* Source */}
      <p className="text-sm text-gray-600">
        <span className="font-medium text-gray-800">{source.finishedGoodName}</span> at {effect.branchName}:{' '}
        <span className="font-medium">{formatQuantity(source.unexpiredOnHand)} {unit}</span> unexpired on hand
        {hasExpired && <>, <span className="text-red-700">{formatQuantity(source.expiredOnHand)} {unit} expired (not usable)</span></>}
        {hasPending && <>, {formatQuantity(source.pending)} {unit} claimed by conversions, write-offs or transfers awaiting approval</>}
        {' '}— <span className="font-medium">{formatQuantity(source.available)} {unit} available</span>.
      </p>
      {source.required !== null && (
        source.enough ? (
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Enough: takes {formatQuantity(source.required)} {unit} {source.finishedGoodName}, soonest to expire first.
          </p>
        ) : (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Not enough: {formatQuantity(source.required)} {unit} {source.finishedGoodName} needed, only{' '}
            {formatQuantity(source.available)} {unit} available. You cannot convert what is not on hand — check the
            figure or the branch.
          </p>
        )
      )}

      {source.lots.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-4 font-medium">{source.finishedGoodName} lot</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 pr-4 text-right font-medium">On hand</th>
                <th className="py-2 pr-4 text-right font-medium">Cost</th>
                <th className="py-2 text-right font-medium">Takes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {source.lots.map(lot => (
                <tr key={lot.lotNumber} className={lot.expired ? 'bg-red-50/60 text-gray-400' : undefined}>
                  <td className="py-1.5 pr-4 font-mono text-xs text-gray-700">{lot.lotNumber}</td>
                  <td className="py-1.5 pr-4 text-gray-600">
                    {lot.expiresAt === null ? '—' : formatDateTime(lot.expiresAt)}
                    {lot.expired ? (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">Expired — not used</span>
                    ) : (
                      // Week 7 Task 3, X4: lots near expiry, which this conversion uses first.
                      <span className="ml-2"><ExpiryBadge flag={lot.expiry} /></span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-gray-600">{formatQuantity(lot.onHand)} {unit}</td>
                  <td className="py-1.5 pr-4 text-right text-gray-500">
                    {lot.unitCost === null ? '—' : <>{formatPeso(lot.unitCost)}/{unit}</>}
                  </td>
                  <td className="py-1.5 text-right font-medium text-gray-800">
                    {Number(lot.take) > 0 ? <>−{formatQuantity(lot.take)} {unit}</> : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-400">No {source.finishedGoodName} lots on hand at {effect.branchName}.</p>
      )}

      {/* Added ingredients */}
      {ingredients.length > 0 && (
        <>
          <p className="mb-1 mt-5 text-sm font-medium text-gray-800">
            Added ingredients ({ingredients.length}) — the recipe scaled to {formatQuantity(source.required ?? '0')} {unit} {source.finishedGoodName}
          </p>
          {negativeCount > 0 && (
            <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {negativeCount} of {ingredients.length} will go below zero. That is allowed — the kitchen used them —
              but it means stock was used that the books never received.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Ingredient</th>
                  <th className="py-2 pr-4 text-right font-medium">Deduct</th>
                  <th className="py-2 pr-4 text-right font-medium">Price</th>
                  <th className="py-2 pr-4 text-right font-medium">On hand now</th>
                  <th className="py-2 text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ingredients.map(line => (
                  <tr key={line.materialId} className={line.goesNegative ? 'bg-red-50/60' : undefined}>
                    <td className="py-1.5 pr-4 text-gray-700">
                      {line.materialName} <span className="font-mono text-xs text-gray-400">{line.materialCode}</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right text-gray-700">
                      −{formatQuantity(line.deduct)} <span className="text-gray-400">{line.unitAbbreviation}</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right text-gray-500">
                      {line.unitPrice === null
                        ? <span className="text-red-700">No price</span>
                        : <>{formatPeso(line.unitPrice)}/{line.unitAbbreviation}</>}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-gray-500">{formatQuantity(line.onHand)}</td>
                    <td className={`py-1.5 text-right font-medium ${line.goesNegative ? 'text-red-700' : 'text-gray-800'}`}>
                      {formatQuantity(line.after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Output */}
      {output.quantity !== null && (
        <p className="mt-5 text-sm text-gray-700">
          Adds <span className="font-medium text-emerald-700">+{formatQuantity(output.quantity)} {output.unitAbbreviation} {output.finishedGoodName}</span>
          {' '}as {lotLabel}
          {output.expiresAt !== null && output.shelfLifeHours !== null && (
            <>, expiring <span className="font-medium">{formatDateTime(output.expiresAt)}</span> ({formatShelfLife(output.shelfLifeHours)} after the conversion)</>
          )}.
          {output.expected !== null && output.percentOfExpected !== null && (
            <span className="text-gray-500">
              {' '}The recipe expects {formatQuantity(output.expected)} {output.unitAbbreviation} from {formatQuantity(source.required ?? '0')} {unit}
              {' '}({formatQuantity(output.percentOfExpected)}%).
            </span>
          )}
        </p>
      )}
      {output.quantity !== null && output.expiresAt === null && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {output.finishedGoodName} has no shelf life, so the new lot could not be given an expiry and approval will be
          refused. An admin sets it in Master Data → Finished Goods.
        </p>
      )}

      {/* D7: what approving records as the conversion's cost. */}
      {cost !== null && (
        <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {cost.total !== null ? (
            <>
              Cost <span className="font-medium">{formatPeso(cost.total)}</span>
              {cost.perUnit !== null && output.quantity !== null && (
                <> for {formatQuantity(output.quantity)} {output.unitAbbreviation} — <span className="font-medium">{formatPeso(cost.perUnit)}/{output.unitAbbreviation}</span></>
              )}
              <span className="text-gray-500">
                {' '}= {source.finishedGoodName} {cost.sourceCost !== null && formatPeso(cost.sourceCost)} (at the lots&apos; recorded cost)
                {' '}+ added ingredients {cost.conversionCost !== null && formatPeso(cost.conversionCost)} (reference prices on {cost.pricedOn}).
              </span>
            </>
          ) : (
            <span className="text-gray-500">
              The cost can be worked out once {source.enough === false ? `enough ${source.finishedGoodName} is on hand` : 'every ingredient has a price'}.
              {cost.conversionCost !== null && <> Added ingredients: {formatPeso(cost.conversionCost)} (prices on {cost.pricedOn}).</>}
            </span>
          )}
        </div>
      )}
      {cost !== null && cost.missing.length > 0 && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          No reference price on {cost.pricedOn} for {cost.missing.join(', ')}, so the cost cannot be recorded and approval will
          be refused. An admin adds one in Master Data (it may be back-dated).
        </p>
      )}
    </div>
  )
}
