import Link from 'next/link'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { OPEN_TRANSFER_LIMIT, type StockTransferSummaryDto } from '@/services/stock-transfer.service'
import type { BranchInventoryDto } from '@/services/branch-inventory.service'

/**
 * A branch's open transfers (Week 8 Task 5, I2): what is on its way to it —
 * with a way in to confirm what arrived for whoever may — and what awaits
 * accounting, from or to it. The number links to the transfer for roles that
 * can open it. No hooks and no 'use client', so it renders on the server.
 */
export function BranchTransfers({ branch, transfers }: Pick<BranchInventoryDto, 'branch' | 'transfers'>) {
  const { arriving, pending, canReceive, canOpen, truncated } = transfers

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold text-gray-800">Transfers</h2>
      <p className="mb-3 text-sm text-gray-400">On their way to {branch.name}, and waiting for accounting to approve.</p>

      {truncated && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Showing the oldest {OPEN_TRANSFER_LIMIT} of each; see Transfers for the rest.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-sky-200 bg-white">
          <div className="border-b border-sky-100 bg-sky-50 px-4 py-3">
            <p className="text-sm font-semibold text-sky-900">Arriving · {arriving.length}</p>
            <p className="text-xs text-sky-700">Dispatched, not yet confirmed. They join the stock when {branch.name} counts what arrived.</p>
          </div>
          {arriving.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing in transit to {branch.name}.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {arriving.map(transfer => (
                <li key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-800">
                      <TransferNumber transfer={transfer} canOpen={canOpen} /> from {transfer.fromBranch.name}
                    </p>
                    <p className="text-gray-600">{goodsOf(transfer)}</p>
                    <p className="text-xs text-gray-400">
                      {transfer.dispatchedAt ? `Dispatched ${formatDateTime(transfer.dispatchedAt)}` : 'Dispatched'}
                      {' · '}
                      {transfer.value === null ? 'value unknown' : `${formatPeso(transfer.value)} at cost`}
                    </p>
                  </div>
                  {/* Their manager or an admin (R3) — the count happens on the transfer itself. */}
                  {canReceive && (
                    <Link
                      href={`/inventory/transfers/${transfer.id}#receive`}
                      className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-600"
                    >
                      Confirm what arrived
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-800">Awaiting approval · {pending.length}</p>
            <p className="text-xs text-gray-500">Recorded; no stock moves until accounting approves.</p>
          </div>
          {pending.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No transfer from or to {branch.name} is waiting.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {pending.map(transfer => {
                const outgoing = transfer.fromBranch.id === branch.id
                return (
                  <li key={transfer.id} className="px-4 py-3 text-sm">
                    <p className="text-gray-800">
                      <TransferNumber transfer={transfer} canOpen={canOpen} />{' '}
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${outgoing ? 'bg-orange-50 text-orange-700' : 'bg-sky-50 text-sky-700'}`}>
                        {outgoing ? `to ${transfer.toBranch.name}` : `from ${transfer.fromBranch.name}`}
                      </span>
                    </p>
                    <p className="text-gray-600">{goodsOf(transfer)}</p>
                    <p className="text-xs text-gray-400">Recorded {formatDateTime(transfer.createdAt)} by {transfer.submittedByName}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function TransferNumber({ transfer, canOpen }: { transfer: StockTransferSummaryDto; canOpen: boolean }) {
  return canOpen ? (
    <Link href={`/inventory/transfers/${transfer.id}`} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
      {transfer.transferNumber}
    </Link>
  ) : (
    <span className="font-mono text-xs text-gray-700">{transfer.transferNumber}</span>
  )
}

function goodsOf(transfer: StockTransferSummaryDto): string {
  return transfer.lines.map(line => `${line.finishedGoodName} ${formatQuantity(line.quantity)} ${line.unitAbbreviation}`).join(', ')
}
