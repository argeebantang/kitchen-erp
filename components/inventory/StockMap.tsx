'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trimDecimal } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { STATUS_STYLES, STOCK_STATUSES, StockTile } from '@/components/inventory/StockTile'
import type { BranchStockDto, StockTileDto } from '@/services/inventory.service'

/** Ids, not the tile itself, so an open popup shows fresh figures after a refresh. */
type Selected = { branchId: string; materialId: string }

/**
 * The branch panels and their tiles. A Client Component only so a tile can be
 * clicked open: the panel is where Week 10's reorder suggestion and "Create
 * Purchase Order" will go.
 */
export function StockMap({ branches }: { branches: BranchStockDto[] }) {
  const [selected, setSelected] = useState<Selected | null>(null)
  // Gone after a refresh (filtered out, material deactivated) → no popup.
  const openBranch = selected && branches.find(branch => branch.branchId === selected.branchId)
  const openTile = openBranch && openBranch.categories
    .flatMap(category => category.tiles)
    .find(tile => tile.materialId === selected.materialId)

  return (
    <>
      <div className="space-y-6">
        {branches.map(branch => {
          const total = Object.values(branch.counts).reduce((sum, count) => sum + count, 0)
          return (
            <section key={branch.branchId} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-gray-800">{branch.branchName}</h2>
                <span className="text-sm text-gray-400">{total} materials</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {STOCK_STATUSES.map(({ status, label, badgeClass }) => (
                  <span key={status} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${badgeClass}`}>
                    {label} · {branch.counts[status]}
                  </span>
                ))}
              </div>

              {branch.categories.length === 0 && (
                <p className="mt-6 text-sm text-gray-400">Nothing here matches these filters.</p>
              )}

              {branch.categories.map(category => (
                <div key={category.name} className="mt-6">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{category.name}</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {category.tiles.map(tile => (
                      <button
                        key={tile.materialId}
                        type="button"
                        onClick={() => setSelected({ branchId: branch.branchId, materialId: tile.materialId })}
                        className="rounded-lg text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                      >
                        <StockTile tile={tile} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>

      {openBranch && openTile && (
        <StockDetail
          tile={openTile}
          branchId={openBranch.branchId}
          branchName={openBranch.branchName}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

type StockDetailProps = { tile: StockTileDto; branchId: string; branchName: string; onClose: () => void }

function StockDetail({ tile, branchId, branchName, onClose }: StockDetailProps) {
  const style = STATUS_STYLES[tile.status]
  const unit = tile.unitAbbreviation
  const ledgerHref = `/inventory/ledger?${new URLSearchParams({ material: tile.materialId, branch: branchId })}`

  return (
    <Modal title={`${tile.materialName} · ${branchName}`} onClose={onClose}>
      <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${style.badgeClass}`}>
        {style.label}
      </span>
      <p className="mt-1 font-mono text-xs text-gray-400">{tile.materialCode}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <dt className="text-gray-500">On hand</dt>
        <dd className="text-right font-semibold text-gray-800">{trimDecimal(tile.quantity)} {unit}</dd>

        <dt className="text-gray-500">Reorder point</dt>
        <dd className="text-right text-gray-700">
          {tile.status === 'UNTRACKED' ? 'Not set' : `${trimDecimal(tile.reorderPoint)} ${unit}`}
        </dd>

        {tile.shortfall !== null && (
          <>
            <dt className="text-gray-500">Short by</dt>
            <dd className="text-right font-medium text-red-700">{trimDecimal(tile.shortfall)} {unit}</dd>
          </>
        )}

        <dt className="text-gray-500">Last movement</dt>
        <dd className="text-right text-gray-700">
          {tile.lastMovementAt
            ? new Date(tile.lastMovementAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
            : 'No movements yet'}
        </dd>
      </dl>

      <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
        <Link href={ledgerHref} className="text-sm font-medium text-orange-600 hover:underline">
          Open ledger →
        </Link>
      </div>
    </Modal>
  )
}
