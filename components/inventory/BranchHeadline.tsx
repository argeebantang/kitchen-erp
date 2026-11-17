import { formatPeso } from '@/lib/format'
import type { BranchHeadlineDto } from '@/services/branch-inventory.service'

/**
 * A branch's figures at a glance (Week 8 Task 5, I2): finished goods, what to
 * use first, raw materials needing a reorder, what is on its way. Plain text,
 * no links — on the index the whole card is the link. No hooks and no
 * 'use client', so it renders on the server.
 */
export function BranchHeadline({ headline, compact = false }: { headline: BranchHeadlineDto; compact?: boolean }) {
  const { finishedGoods, expiredLots, expiringLots, materials, arriving } = headline
  const tiles = [
    {
      label: 'Finished goods',
      value: compact || finishedGoods.value === null ? `${finishedGoods.lots} ${finishedGoods.lots === 1 ? 'lot' : 'lots'}` : formatPeso(finishedGoods.value),
      note:  compact
        ? `${finishedGoods.goods} ${finishedGoods.goods === 1 ? 'good' : 'goods'}`
        : `${finishedGoods.lots} ${finishedGoods.lots === 1 ? 'lot' : 'lots'} of ${finishedGoods.goods} ${finishedGoods.goods === 1 ? 'good' : 'goods'}, at cost`,
      tone:  'text-gray-900',
    },
    {
      label: 'Use first',
      value: expiredLots > 0 ? `${expiredLots} expired` : expiringLots > 0 ? `${expiringLots} expiring` : 'Nothing urgent',
      note:  expiredLots > 0
        ? `${expiringLots} more expiring within 48 h`
        : expiringLots > 0 ? `${expiringLots === 1 ? 'lot' : 'lots'} within 48 h` : 'no lot expires within 48 h',
      tone:  expiredLots > 0 ? 'text-red-700' : expiringLots > 0 ? 'text-amber-700' : 'text-emerald-700',
    },
    {
      label: 'Raw materials',
      value: materials.out > 0 ? `${materials.out} out` : materials.low > 0 ? `${materials.low} low` : 'All stocked',
      note:  materials.out > 0
        ? `${materials.low} low · ${materials.total} tracked`
        : `${materials.total} tracked`,
      tone:  materials.out > 0 ? 'text-red-700' : materials.low > 0 ? 'text-amber-700' : 'text-emerald-700',
    },
    {
      label: 'Arriving',
      value: arriving === 0 ? 'Nothing' : `${arriving} ${arriving === 1 ? 'transfer' : 'transfers'}`,
      note:  'in transit to this branch',
      tone:  arriving > 0 ? 'text-sky-700' : 'text-gray-500',
    },
  ]

  return (
    <div className={`grid grid-cols-2 gap-3 ${compact ? '' : 'lg:grid-cols-4'}`}>
      {tiles.map(tile => (
        <div key={tile.label} className={`rounded-lg border border-gray-200 bg-white ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{tile.label}</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${compact ? 'text-base' : 'text-xl'} ${tile.tone}`}>{tile.value}</p>
          <p className="text-xs text-gray-400">{tile.note}</p>
        </div>
      ))}
    </div>
  )
}
