import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PackageCheck, SearchX, Store } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatQuantity } from '@/lib/format'
import { SEARCH_MAX } from '@/lib/list-query'
import { StockTransferService } from '@/services/stock-transfer.service'
import { ReturnBadge } from '@/components/inventory/BranchTransfers'
import { EmptyState } from '@/components/ui/states'
import { SearchBox } from '@/components/ui/SearchBox'
import { TransferScanner } from '@/components/inventory/TransferScanner'
import { config } from '@/lib/config'

type PageProps = {
  searchParams: Promise<{ q?: string }>
}

/**
 * Receive (Week 12): what is on its way to the viewer, oldest first, to open
 * and count on a phone at the door — a branch manager's deliveries and
 * returns, production's returns, everything for an admin. Scanning a label
 * opens the same transfer page; the list and the number search are the way
 * in without one. Counting happens on the transfer itself (#receive).
 */
export default async function ReceivePage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const q = ((await searchParams).q ?? '').trim().slice(0, SEARCH_MAX)
  const { transfers, truncated, branch, managesNoBranch } = await StockTransferService.listReceivable(
    { userId: session.userId, role: session.role },
    q || undefined,
  )

  const scopeText = branch
    ? `on their way to ${branch.name}`
    : session.role === 'PRODUCTION_MANAGER'
      ? 'returns on their way to the kitchens'
      : 'on their way to any branch'

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Receive</h1>
        <p className="mt-1 text-sm text-gray-400">
          Transfers {scopeText}, oldest first. Open one to count what arrived.
        </p>
      </div>

      {managesNoBranch ? (
        <EmptyState icon={Store} title="You don't manage a branch yet">
          An admin assigns branch managers in Master Data → Branches.
        </EmptyState>
      ) : (
        <>
          <TransferScanner appUrl={config.appUrl} />
          <div className="mb-4">
            <SearchBox placeholder="Or type the transfer number, e.g. 261" />
          </div>

          {transfers.length === 0 ? (
            q ? (
              <EmptyState
                icon={SearchX}
                title={`Nothing on its way matches “${q}”`}
                action={{ href: `/inventory/transfers?q=${encodeURIComponent(q)}`, label: 'Search all transfers' }}
              >
                It may already be received, still waiting for approval, or going to another branch.
              </EmptyState>
            ) : (
              <EmptyState icon={PackageCheck} title="Nothing to receive">
                Transfers show here once they are dispatched, until someone confirms what arrived.
              </EmptyState>
            )
          ) : (
            <ul className="space-y-3">
              {transfers.map(transfer => (
                <li key={transfer.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p>
                      <span className="font-mono text-base font-semibold text-gray-800">{transfer.transferNumber}</span>
                      {transfer.kind === 'RETURN' && <ReturnBadge />}
                    </p>
                    <p className="text-xs text-gray-400">
                      {transfer.dispatchedAt ? `Left ${formatDateTime(transfer.dispatchedAt)}` : 'Dispatched'}
                    </p>
                  </div>
                  <p className="mt-0.5 text-sm text-gray-600">
                    {transfer.fromBranch.name} <span className="text-gray-300">→</span> {transfer.toBranch.name}
                  </p>
                  <ul className="mt-2 text-sm text-gray-700">
                    {transfer.lines.map(line => (
                      <li key={line.finishedGoodId}>
                        {line.finishedGoodName}{' '}
                        <span className="tabular-nums text-gray-500">{formatQuantity(line.quantity)} {line.unitAbbreviation}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/inventory/transfers/${transfer.id}#receive`}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 sm:w-auto sm:inline-flex"
                  >
                    <PackageCheck size={16} /> Count what arrived
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {truncated && (
            <p className="mt-3 text-sm text-gray-500">
              Showing the oldest {transfers.length}. Search by number to find a later one.
            </p>
          )}
        </>
      )}
    </div>
  )
}
