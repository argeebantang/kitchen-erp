import Link from 'next/link'
// Type-only: worked out on the server.
import type { KitchenAiTileDto } from '@/services/dashboard.service'
import { AiBadge } from '@/components/ai/AiBadge'

/**
 * "KitchenAI at a glance" (Week 10 Task 7): one tile per AI feature the
 * viewer may use, in the roadmap's order — the headline is the system's own
 * figure, the link goes to where the feature lives.
 */
export function KitchenAiOverview({ tiles }: { tiles: KitchenAiTileDto[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map(tile => (
        <div key={tile.feature} className="flex flex-col rounded-xl border border-purple-100 bg-white p-4">
          <p className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            <span>{tile.feature} · {tile.title}</span>
            <AiBadge />
          </p>
          <p className="mt-2 text-sm text-gray-800">{tile.headline}</p>
          {tile.detail && <p className="mt-1 text-xs text-gray-500">{tile.detail}</p>}
          {tile.href && tile.linkLabel && (
            <Link href={tile.href} className="mt-auto pt-3 text-sm font-medium text-orange-600 hover:underline">
              {tile.linkLabel} →
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}
