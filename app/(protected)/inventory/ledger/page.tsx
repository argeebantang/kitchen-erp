import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { formatPeso, trimDecimal } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { InventoryService } from '@/services/inventory.service'
import { MaterialService } from '@/services/material.service'
import { BranchRepository } from '@/repositories/branch.repository'

const PAGE_SIZE = 50

type PageProps = {
  searchParams: Promise<{ material?: string; branch?: string; page?: string }>
}

export default async function StockLedgerPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Filters arrive as plain query strings from the GET form below. An id that
  // matches nothing simply filters to an empty ledger.
  const { material = '', branch = '', page: pageParam } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)

  const [{ movements, total, reconciliation }, { materials }, branches] = await Promise.all([
    InventoryService.ledger(
      { materialId: material || undefined, branchId: branch || undefined, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE },
      { role: session.role },
    ),
    MaterialService.list({ take: 200 }),
    BranchRepository.findAllActive(),
  ])
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // The unit for the summary, from the material picked — the page may have no rows.
  const unit = materials.find(option => option.id === material)?.unitAbbreviation ?? ''
  const showBalance = reconciliation !== null

  const pageHref = (target: number) => {
    const query = new URLSearchParams()
    if (material) query.set('material', material)
    if (branch)   query.set('branch', branch)
    if (target > 1) query.set('page', String(target))
    const text = query.toString()
    return text ? `/inventory/ledger?${text}` : '/inventory/ledger'
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Stock Ledger</h1>
        <p className="mt-1 text-sm text-gray-400">
          Every change to stock, newest first, with the document that caused it. Quantities are signed:
          positive into stock, negative out of it. Pick one material and one branch to see the running balance.
        </p>
      </div>

      {/* A GET form: the filters live in the URL, so a filtered ledger can be linked to. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block min-w-56">
          <span className="mb-1 block text-xs font-medium text-gray-500">Material</span>
          <select name="material" defaultValue={material} className={inputClass}>
            <option value="">All materials</option>
            {materials.map(option => (
              <option key={option.id} value={option.id}>{option.name} ({option.code})</option>
            ))}
          </select>
        </label>
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Branch</span>
          <select name="branch" defaultValue={branch} className={inputClass}>
            <option value="">All branches</option>
            {branches.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {(material || branch) && (
          <Link href="/inventory/ledger" className={secondaryButtonClass}>Clear</Link>
        )}
      </form>

      {reconciliation && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
            reconciliation.matches
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {reconciliation.matches ? (
            <>
              <span className="font-medium">✓ Ledger {trimDecimal(reconciliation.ledgerTotal)} {unit}</span>
              {' = stock level '}{trimDecimal(reconciliation.stockLevel)} {unit}.
            </>
          ) : (
            <>
              <span className="font-medium">
                ✗ Ledger {trimDecimal(reconciliation.ledgerTotal)} {unit} ≠ stock level {trimDecimal(reconciliation.stockLevel)} {unit}.
              </span>{' '}
              Something changed one without the other — every stock change must write both.
            </>
          )}
        </div>
      )}

      {movements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No stock movements</p>
          <p className="mt-1 text-sm text-gray-400">
            {material || branch ? 'Nothing matches these filters.' : 'Stock changes when accounting approves a receiving report.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                <th className="px-4 py-3 text-right font-medium">Unit cost</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                {showBalance && <th className="px-4 py-3 text-right font-medium">Balance</th>}
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map(row => {
                const negative = row.quantity.startsWith('-')
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-gray-500">{row.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{row.materialName}</p>
                      <p className="font-mono text-xs text-gray-400">{row.materialCode}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-500">{row.type}</td>
                    <td className={`px-4 py-3 text-right font-medium ${negative ? 'text-red-700' : 'text-emerald-700'}`}>
                      {negative ? '−' : '+'}{trimDecimal(row.quantity.replace(/^-/, ''))}{' '}
                      <span className="font-normal text-gray-400">{row.unitAbbreviation}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {row.unitCost === null ? '—' : formatPeso(row.unitCost)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {row.value === null ? '—' : formatPeso(row.value)}
                    </td>
                    {showBalance && (
                      <td className="px-4 py-3 text-right font-medium text-gray-800">
                        {row.balance === null ? '—' : trimDecimal(row.balance)}{' '}
                        <span className="font-normal text-gray-400">{row.unitAbbreviation}</span>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {row.source.href ? (
                        <Link href={row.source.href} className="font-mono text-xs text-orange-600 hover:underline">
                          {row.source.number ?? row.source.type}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-gray-500">{row.source.number ?? row.source.type}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pageCount} · {total} movements</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageHref(page - 1)} className={secondaryButtonClass}>Newer</Link>}
            {page < pageCount && <Link href={pageHref(page + 1)} className={secondaryButtonClass}>Older</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
