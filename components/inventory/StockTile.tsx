import { trimDecimal } from '@/lib/format'
import type { StockStatus, StockTileDto } from '@/services/inventory.service'

type StatusStyle = { label: string; meaning: string; badgeClass: string; tileClass: string }

/** Labels and colours for the four statuses. */
export const STATUS_STYLES: Record<StockStatus, StatusStyle> = {
  OUT: {
    label: '🔴 Out of stock', meaning: 'nothing on hand',
    badgeClass: 'border-red-200 bg-red-50 text-red-800',
    tileClass:  'border-red-300 bg-red-50',
  },
  LOW: {
    label: '🟡 Low', meaning: 'at or below the reorder point',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    tileClass:  'border-amber-300 bg-amber-50',
  },
  HEALTHY: {
    label: '🟢 Healthy', meaning: 'above the reorder point',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tileClass:  'border-emerald-300 bg-emerald-50',
  },
  UNTRACKED: {
    label: '⚪ No reorder point', meaning: 'set one in Master Data to track it',
    badgeClass: 'border-gray-200 bg-gray-50 text-gray-600',
    tileClass:  'border-gray-200 bg-white',
  },
}

/** The statuses in display order — worst first — for legends and counts. */
export const STOCK_STATUSES = (['OUT', 'LOW', 'HEALTHY', 'UNTRACKED'] as const)
  .map(status => ({ status, ...STATUS_STYLES[status] }))

/** One material at one branch on the stock map. */
export function StockTile({ tile }: { tile: StockTileDto }) {
  const style = STATUS_STYLES[tile.status]
  return (
    <div className={`rounded-lg border p-3 ${style.tileClass}`}>
      <p className="truncate text-sm font-medium text-gray-800" title={tile.materialName}>{tile.materialName}</p>
      <p className="font-mono text-xs text-gray-400">{tile.materialCode}</p>
      <p className="mt-2 text-lg font-semibold text-gray-800">
        {trimDecimal(tile.quantity)} <span className="text-sm font-normal text-gray-500">{tile.unitAbbreviation}</span>
      </p>
      <p className="text-xs text-gray-500">
        {tile.status === 'UNTRACKED'
          ? 'No reorder point'
          : `Reorder at ${trimDecimal(tile.reorderPoint)} ${tile.unitAbbreviation}`}
      </p>
    </div>
  )
}
