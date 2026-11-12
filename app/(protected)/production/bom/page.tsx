import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { BomService } from '@/services/bom.service'
import { trimDecimal } from '@/lib/format'

type PageProps = {
  searchParams: Promise<{ finishedGoodId?: string; includeSuperseded?: string }>
}

export default async function BomListPage({ searchParams }: PageProps) {
  const { finishedGoodId, includeSuperseded } = await searchParams
  const showAll = includeSuperseded === 'true'

  const { boms } = await BomService.list({
    finishedGoodId,
    includeSuperseded: showAll,
    take: 100,
  })

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bill of Materials</h1>
          <p className="mt-1 text-sm text-gray-400">
            Recipes per batch: production recipes, and conversion recipes that turn one finished good
            into another. {showAll ? 'Showing all versions.' : 'Showing active versions only.'}
          </p>
        </div>

        <Link
          href={showAll ? '/production/bom' : '/production/bom?includeSuperseded=true'}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          {showAll ? 'Active only' : 'Show all versions'}
        </Link>
      </div>

      {boms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No BOMs yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Create a finished good in Master Data, then define its recipe here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boms.map(bom => (
            <Link
              key={bom.id}
              href={`/production/bom/${bom.id}`}
              className="rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-orange-300"
            >
              <div className="mb-3 flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ClipboardList size={18} />
                </span>
                <div className="flex items-center gap-1.5">
                  {bom.kind === 'CONVERSION' && (
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                      Conversion
                    </span>
                  )}
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                    v{bom.version}
                  </span>
                  {bom.isActive ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      Active
                    </span>
                  ) : (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-400">
                      Superseded
                    </span>
                  )}
                </div>
              </div>

              <p className="font-semibold text-gray-800">{bom.finishedGoodName}</p>
              <p className="font-mono text-xs text-gray-400">{bom.finishedGoodCode}</p>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                <span>
                  <span className="font-medium text-gray-700">
                    {trimDecimal(bom.batchSize)} {bom.batchUnitAbbreviation}
                  </span>{' '}
                  batch
                </span>
                {bom.source && (
                  <span>
                    from{' '}
                    <span className="font-medium text-violet-700">
                      {trimDecimal(bom.source.quantity)} {bom.source.unitAbbreviation} {bom.source.name}
                    </span>
                  </span>
                )}
                <span>{bom.lineCount} {bom.source ? 'added ingredients' : 'ingredients'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
