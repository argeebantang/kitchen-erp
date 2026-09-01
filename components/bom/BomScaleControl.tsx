'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type Props = {
  batchSize: string
  batchUnitAbbreviation: string
  currentTarget: string
}

/**
 * Drives the scaled viewer by pushing the target quantity into the URL, which
 * re-runs the Server Component that computed the scaled lines.
 *
 * The multiplication deliberately does NOT happen here. Quantities are
 * Prisma Decimals; doing the arithmetic in the browser would mean JS floats,
 * reintroducing the imprecision Decimal exists to prevent into numbers that
 * Weeks 6-8 will cost. Keeping it server-side also means BomService.scaleBom
 * is the single implementation, which Week 5 reuses to derive production order
 * requirements — so the viewer and the production order cannot disagree.
 *
 * Cost of that choice: one round trip per change, debounced below.
 */
export function BomScaleControl({ batchSize, batchUnitAbbreviation, currentTarget }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  const [value, setValue] = useState(currentTarget)

  // Debounced so typing "12.5" issues one request, not four.
  useEffect(() => {
    if (value === currentTarget) return

    const timer = setTimeout(() => {
      const isValid = /^\d*\.?\d+$/.test(value) && Number(value) > 0
      if (!isValid) return

      startTransition(() => {
        router.replace(`${pathname}?qty=${encodeURIComponent(value)}`, { scroll: false })
      })
    }, 350)

    return () => clearTimeout(timer)
  }, [value, currentTarget, pathname, router])

  const presets = [0.5, 1, 2, 5].map(multiplier => ({
    multiplier,
    label: `${multiplier}×`,
    qty:   String(Number(batchSize) * multiplier),
  }))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Scale to batch size
      </label>
      <p className="mb-3 text-xs text-gray-400">
        Recipe is written for {batchSize} {batchUnitAbbreviation}. Enter a target output and every
        ingredient scales with it.
      </p>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-12 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
            {batchUnitAbbreviation}
          </span>
        </div>

        {presets.map(preset => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setValue(preset.qty)}
            className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {pending && <p className="mt-2 text-xs text-gray-400">Recalculating...</p>}
    </div>
  )
}
