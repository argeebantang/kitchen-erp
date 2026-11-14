import { formatPeso, formatQuantity } from '@/lib/format'
import { transferVarianceReasonLabel } from '@/lib/transfer-variance'
import type { StockTransferDetailDto } from '@/services/stock-transfer.service'

/**
 * What a transfer lost on the road (Week 8 Task 4, V5, V7): each lot that
 * arrived short — sent, received, short and its value at the lot's cost —
 * with the reason and note the receiving branch gave. Recorded once at
 * receipt; there is nothing to approve (V6). No hooks and no 'use client', so
 * it renders on the server.
 */
export function TransferVariance({ transfer }: { transfer: StockTransferDetailDto }) {
  if (transfer.lostInTransit.length === 0) return null

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-amber-200 bg-white">
      <div className="border-b border-amber-100 bg-amber-50 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-amber-900">Lost in transit</h2>
          <p className="text-base font-semibold tabular-nums text-amber-800">
            {transfer.varianceValue === null ? 'value unknown' : formatPeso(transfer.varianceValue)}
          </p>
        </div>
        <p className="mt-1 text-sm text-amber-800">
          <span className="font-medium">{transfer.varianceReason ? transferVarianceReasonLabel(transfer.varianceReason) : 'No reason recorded'}</span>
          {transfer.varianceNotes && <> — {transfer.varianceNotes}</>}
        </p>
        <p className="mt-0.5 text-xs text-amber-700">
          Recorded by {transfer.receivedByName ?? 'the receiving branch'} when it confirmed receipt. It left {transfer.fromBranch.name}
          {' '}but never reached {transfer.toBranch.name}&apos;s stock, so it is on neither branch&apos;s books.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Lot</th>
            <th className="px-4 py-2 text-right font-medium">Sent</th>
            <th className="px-4 py-2 text-right font-medium">Received</th>
            <th className="px-4 py-2 text-right font-medium">Short</th>
            <th className="px-4 py-2 text-right font-medium">Value lost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {transfer.lostInTransit.map(lot => (
            <tr key={lot.lotId}>
              <td className="px-4 py-2 text-gray-700">
                {lot.finishedGoodName} <span className="font-mono text-xs text-gray-500">{lot.lotNumber}</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">{formatQuantity(lot.sent)} {lot.unitAbbreviation}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">{formatQuantity(lot.received)} {lot.unitAbbreviation}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums text-amber-700">{formatQuantity(lot.short)} {lot.unitAbbreviation}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">
                {lot.value === null ? <span className="text-gray-400">no cost</span> : formatPeso(lot.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
