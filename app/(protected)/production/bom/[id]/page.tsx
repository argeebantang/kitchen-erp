import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { BomService } from '@/services/bom.service'
import { BomScaleControl } from '@/components/bom/BomScaleControl'
import { trimDecimal, formatPeso } from '@/lib/format'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ qty?: string }>
}

export default async function BomDetailPage({ params, searchParams }: PageProps) {
  // Both are Promises in Next 15 — awaited together rather than sequentially.
  const [{ id }, { qty }] = await Promise.all([params, searchParams])

  const result = await BomService.getById(id, qty)

  if (!result.success) {
    if (result.status === 404) notFound()
    throw new Error(result.error)
  }

  const bom = result.data
  const [versionsResult] = await Promise.all([BomService.versions(bom.finishedGoodId)])
  const versions = versionsResult.success ? versionsResult.data : []

  const isScaled = trimDecimal(bom.targetQuantity) !== trimDecimal(bom.batchSize)

  return (
    <div className="max-w-6xl">
      <Link
        href="/production/bom"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} /> All BOMs
      </Link>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-800">{bom.finishedGoodName}</h1>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              v{bom.version}
            </span>
            {bom.isActive ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                Active
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                Superseded
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-sm text-gray-400">{bom.finishedGoodCode}</p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-gray-400">Estimated batch cost</p>
          {bom.totalCost !== null ? (
            <p className="text-2xl font-bold text-gray-800">
              {formatPeso(bom.totalCost)}
            </p>
          ) : (
            <p className="mt-1 flex items-center justify-end gap-1.5 text-sm text-amber-600">
              <AlertTriangle size={15} /> Some ingredients unpriced
            </p>
          )}
        </div>
      </div>

      {!bom.isActive && (
        <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
          This is a superseded version, kept for history. Production orders that used it still
          reference these exact quantities.
        </div>
      )}

      <div className="mb-6">
        <BomScaleControl
          batchSize={trimDecimal(bom.batchSize)}
          batchUnitAbbreviation={bom.batchUnitAbbreviation}
          currentTarget={trimDecimal(bom.targetQuantity)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Ingredient</th>
              <th className="px-4 py-3 text-right font-medium">
                Per {trimDecimal(bom.batchSize)} {bom.batchUnitAbbreviation}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {isScaled ? (
                  <span className="text-orange-600">
                    For {trimDecimal(bom.targetQuantity)} {bom.batchUnitAbbreviation}
                  </span>
                ) : (
                  'Required'
                )}
              </th>
              <th className="px-4 py-3 text-right font-medium">Line cost</th>
              <th className="px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bom.lines.map(line => (
              <tr key={line.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{line.materialName}</p>
                  <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {trimDecimal(line.batchQuantity)} {line.unitAbbreviation}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${isScaled ? 'text-orange-600' : 'text-gray-800'}`}>
                  {trimDecimal(line.scaledQuantity)} {line.unitAbbreviation}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {line.lineCost !== null
                    ? <span className="text-gray-700">{formatPeso(line.lineCost)}</span>
                    : <span className="text-amber-600" title="No price recorded for this material">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500">{line.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
          {bom.totalCost !== null && (
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                  Total for {trimDecimal(bom.targetQuantity)} {bom.batchUnitAbbreviation}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-800">
                  {formatPeso(bom.totalCost)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={3} className="px-4 pb-3 text-right text-xs text-gray-400">
                  Cost per {bom.batchUnitAbbreviation}
                </td>
                <td className="px-4 pb-3 text-right tabular-nums text-xs text-gray-500">
                  {bom.costPerUnit && formatPeso(bom.costPerUnit)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {bom.notes && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Method notes
          </p>
          <p className="text-sm text-gray-600">{bom.notes}</p>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Version history</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Batch</th>
                <th className="px-4 py-3 font-medium">Ingredients</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {versions.map(version => (
                <tr
                  key={version.id}
                  className={version.id === bom.id ? 'bg-orange-50/50' : 'hover:bg-gray-50'}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/bom/${version.id}`}
                      className="font-medium text-gray-800 hover:text-orange-600"
                    >
                      v{version.version}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-600">
                    {trimDecimal(version.batchSize)} {version.batchUnitAbbreviation}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{version.lineCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {version.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    {version.isActive
                      ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                      : <span className="text-xs text-gray-400">Superseded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
