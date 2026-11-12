'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { trimDecimal } from '@/lib/format'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into
// the browser.
import type { ConversionPreviewDto, ConversionRecipeDto } from '@/services/conversion-order.service'
import { ConversionEffect } from '@/components/production/ConversionEffect'

type Branch = { id: string; name: string }

type Values = {
  bomId: string
  branchId: string
  sourceQty: string
  outputQty: string
  notes: string
}

type Props = {
  recipes: ConversionRecipeDto[]
  branches: Branch[]
  initial: Values
}

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

function positive(value: string): boolean {
  return QUANTITY_PATTERN.test(value) && Number(value) > 0
}

/**
 * The preview's query string, or null until a recipe and branch are chosen.
 * Quantities are sent only once they parse, so what is on hand shows before
 * anything is typed.
 */
function previewQuery(values: Values): string | null {
  if (!values.bomId || !values.branchId) return null
  const query = new URLSearchParams({ bomId: values.bomId, branchId: values.branchId })
  if (positive(values.sourceQty)) query.set('sourceQty', values.sourceQty)
  if (positive(values.outputQty)) query.set('outputQty', values.outputQty)
  return query.toString()
}

type PreviewResult = { query: string; data: ConversionPreviewDto } | { query: string; error: string }

const PREVIEW_DELAY_MS = 300

/**
 * Records a conversion that has already happened (Week 7 Task 1, D4): what
 * was used, what was made, where. Submitting sends it straight to accounting;
 * there is no draft. The server checks everything again.
 */
export function ConversionOrderForm({ recipes, branches, initial }: Props) {
  const [values, setValues]         = useState(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const router = useRouter()

  const recipe = recipes.find(candidate => candidate.bomId === values.bomId)

  function update(patch: Partial<Values>) {
    setValues(current => ({ ...current, ...patch }))
  }

  const fieldErrors: string[] = []
  if (values.sourceQty !== '' && !positive(values.sourceQty)) {
    fieldErrors.push(`${recipe?.sourceName ?? 'Source'} used must be a number greater than zero.`)
  }
  if (values.outputQty !== '' && !positive(values.outputQty)) {
    fieldErrors.push(`${recipe?.finishedGoodName ?? 'Output'} made must be a number greater than zero.`)
  }

  // Loading is derived — the result answers an older query — so the effect
  // only ever writes a finished answer (as in ProductionOrderForm).
  const query = previewQuery(values)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const previewLoading = query !== null && preview?.query !== query

  useEffect(() => {
    if (query === null) return
    // Wait for typing to pause, and abort an answer that is no longer wanted.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/conversion-orders/preview?${query}`, { signal: controller.signal })
        const body = await response.json().catch(() => null)
        setPreview(response.ok
          ? { query, data: body.preview }
          : { query, error: body?.error ?? `Request failed (${response.status})` })
      } catch {
        if (!controller.signal.aborted) setPreview({ query, error: 'Could not reach the server' })
      }
    }, PREVIEW_DELAY_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // The server refuses this too; the current answer says it before the click.
  const notEnough = preview !== null && preview.query === query && 'data' in preview && preview.data.effect.source.enough === false
  const incomplete = !values.bomId || !values.branchId || !values.sourceQty || !values.outputQty

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // The submitter is deliberately absent: the server takes it from x-user-id.
    const payload = {
      bomId:     values.bomId,
      branchId:  values.branchId,
      sourceQty: values.sourceQty,
      outputQty: values.outputQty,
      notes:     values.notes || null,
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/conversion-orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      router.push(`/production/conversions/${body.conversionOrder.id}`)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Conversion recipe">
          <select value={values.bomId} onChange={event => update({ bomId: event.target.value })} className={inputClass}>
            <option value="">Choose what was made…</option>
            {recipes.map(candidate => (
              <option key={candidate.bomId} value={candidate.bomId}>
                {candidate.finishedGoodName} from {candidate.sourceName} (Conversion v{candidate.version})
              </option>
            ))}
          </select>
          {recipe && (
            <p className="mt-1 text-xs text-gray-500">
              One batch: {trimDecimal(recipe.sourceQuantity)} {recipe.sourceUnitAbbreviation} {recipe.sourceName} + added
              ingredients → {trimDecimal(recipe.batchSize)} {recipe.unitAbbreviation} {recipe.finishedGoodName}
            </p>
          )}
        </Field>

        <Field label="Branch">
          <select value={values.branchId} onChange={event => update({ branchId: event.target.value })} className={inputClass}>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Field>

        <Field label={`${recipe?.sourceName ?? 'Source'} used${recipe ? ` (${recipe.sourceUnitAbbreviation})` : ''}`}>
          <input
            type="text"
            inputMode="decimal"
            value={values.sourceQty}
            onChange={event => update({ sourceQty: event.target.value })}
            placeholder={recipe ? `e.g. ${trimDecimal(recipe.sourceQuantity)}` : 'Choose a recipe first'}
            className={inputClass}
          />
        </Field>

        <Field label={`${recipe?.finishedGoodName ?? 'Output'} made${recipe ? ` (${recipe.unitAbbreviation})` : ''}`}>
          <input
            type="text"
            inputMode="decimal"
            value={values.outputQty}
            onChange={event => update({ outputQty: event.target.value })}
            placeholder={recipe ? 'What you actually weighed' : 'Choose a recipe first'}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          value={values.notes}
          onChange={event => update({ notes: event.target.value })}
          placeholder="Why it was converted, anything accounting should know…"
          className={inputClass}
        />
      </Field>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">What this conversion moves</h2>
        <p className="mb-3 text-sm text-gray-400">
          Nothing moves until accounting approves it; this is what approving now would do.
          {previewLoading && preview !== null && ' Updating…'}
        </p>
        {query === null ? (
          <p className="text-sm text-gray-400">Choose a recipe and branch to see what is on hand.</p>
        ) : preview === null ? (
          <p className="text-sm text-gray-400">Calculating…</p>
        ) : 'error' in preview ? (
          <p className="text-sm text-red-600">{preview.error}</p>
        ) : (
          // The previous answer stays, dimmed, while the next one loads.
          <div className={previewLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            <ConversionEffect
              effect={preview.data.effect}
              title={`From ${recipe?.finishedGoodName ?? ''} Conversion v${preview.data.bomVersion}`}
              lotLabel="a new lot numbered after this conversion"
            />
          </div>
        )}
      </section>

      {fieldErrors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fieldErrors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={incomplete || fieldErrors.length > 0 || notEnough || submitting}
          className={primaryButtonClass}
        >
          {submitting ? 'Submitting…' : 'Submit for approval'}
        </button>
        <Link href="/production/conversions" className={secondaryButtonClass}>Cancel</Link>
        <span className="text-xs text-gray-400">Submitting sends it to accounting — there is no draft.</span>
      </div>
    </form>
  )
}
