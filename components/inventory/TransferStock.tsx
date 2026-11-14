import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import type { StockTransferDetailDto, TransferMovementDto } from '@/services/stock-transfer.service'

/**
 * What a transfer moved (Week 8 Task 3): the lots that left the sender when
 * accounting approved it, and the same lots arriving at the receiver when it
 * confirmed receipt — each at the lot's own cost. No hooks and no
 * 'use client', so it renders on the server.
 */
export function TransferStock({ transfer }: { transfer: StockTransferDetailDto }) {
  const { out, in: arrived, outValue, inValue } = transfer.stockMoved
  if (out.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-800">Stock moved</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title={`Out of ${transfer.fromBranch.name}`}
          subtitle={`Dispatched ${formatDateTime(out[0].at)}, when accounting approved it`}
          rows={out}
          total={outValue}
        />
        {arrived.length > 0 ? (
          <Side
            title={`Into ${transfer.toBranch.name}`}
            subtitle={`Received ${formatDateTime(arrived[0].at)}${transfer.receivedByName ? ` — confirmed by ${transfer.receivedByName}` : ''}`}
            rows={arrived}
            total={inValue}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/50 p-4 text-sm text-sky-800">
            <p className="font-medium">In transit to {transfer.toBranch.name}</p>
            <p className="mt-1 text-sky-700">
              The goods are on their way. They join {transfer.toBranch.name}&apos;s stock — the same lots, expiry and cost —
              when its manager confirms they arrived.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Side({ title, subtitle, rows, total }: {
  title: string
  subtitle: string
  rows: TransferMovementDto[]
  total: string | null
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Lot</th>
            <th className="px-4 py-2 text-right font-medium">Quantity</th>
            <th className="px-4 py-2 text-right font-medium">Value at cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(row => (
            <tr key={`${row.lotNumber}-${row.at}`}>
              <td className="px-4 py-2 text-gray-700">
                {row.finishedGoodName} <span className="font-mono text-xs text-gray-500">{row.lotNumber}</span>{' '}
                <ExpiryBadge flag={row.expiry} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">{formatQuantity(row.quantity)} {row.unitAbbreviation}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-800">
                {row.value === null ? <span className="text-gray-400">—</span> : formatPeso(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
        {total !== null && (
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={2} className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-800">{formatPeso(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
