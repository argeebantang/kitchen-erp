'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { trimDecimal } from '@/lib/format'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into
// the browser.
import type { PlannableGoodDto, RequirementsPreviewDto } from '@/services/production-order.service'
import { MaterialRequirementsTable } from '@/components/production/MaterialRequirementsTable'

type Branch = { id: string; name: string }

export type ProductionOrderValues = {
  finishedGoodId: string
  batchWeight: string
  batchCount: string
  plannedDate: string
  branchId: string
  notes: string
}

type Props = {
  /** Set when editing a draft: the form PATCHes it instead of creating one. */
  productionOrderId?: string
  goods: PlannableGoodDto[]
  branches: Branch[]
  today: string
  /** MAX_BATCH_COUNT, passed in because a Client Component cannot import values from services/. */
  maxBatchCount: number
  initial: ProductionOrderValues
}

const WEIGHT_PATTERN = /^\d+(\.\d+)?$/
const COUNT_PATTERN  = /^\d+$/

// Display only: the service computes plannedQty in Decimal. Millionths avoid
// 10.1 × 3 = 30.299999999999997.
function plannedTotal(weight: string, count: string): string | null {
  if (!WEIGHT_PATTERN.test(weight) || !COUNT_PATTERN.test(count)) return null
  return String((Math.round(Number(weight) * 1_000_000) * Number(count)) / 1_000_000)
}

/**
 * The preview's query string, or null while the inputs cannot be scaled yet.
 * Same checks as fieldErrors, so a request is only sent for values the server
 * would accept.
 */
function previewQuery(values: ProductionOrderValues, maxBatchCount: number): string | null {
  const { finishedGoodId, batchWeight, batchCount, branchId } = values
  if (!finishedGoodId || !branchId) return null
  if (!WEIGHT_PATTERN.test(batchWeight) || Number(batchWeight) <= 0) return null
  if (!COUNT_PATTERN.test(batchCount) || Number(batchCount) < 1 || Number(batchCount) > maxBatchCount) return null
  // The branch is part of the query, so changing it re-checks the stock there.
  return new URLSearchParams({ finishedGoodId, batchWeight, batchCount, branchId }).toString()
}

/** The last preview answer, tagged with the query it answers. */
type PreviewResult = { query: string; data: RequirementsPreviewDto } | { query: string; error: string }

const PREVIEW_DELAY_MS = 300

export function ProductionOrderForm({ productionOrderId, goods, branches, today, maxBatchCount, initial }: Props) {
  const isEdit = productionOrderId !== undefined
  const [values, setValues]         = useState(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const router = useRouter()

  const good = goods.find(candidate => candidate.finishedGoodId === values.finishedGoodId)

  function update(patch: Partial<ProductionOrderValues>) {
    setValues(current => ({ ...current, ...patch }))
  }

  // A different product has a different recipe, so its batch size replaces
  // whatever weight was typed for the previous one.
  function chooseGood(finishedGoodId: string) {
    const chosen = goods.find(candidate => candidate.finishedGoodId === finishedGoodId)
    update({ finishedGoodId, batchWeight: chosen ? trimDecimal(chosen.batchSize) : '' })
  }

  // For the person typing; the service re-checks every one of these.
  const fieldErrors: string[] = []
  if (good && !good.unitsMatch) {
    fieldErrors.push(`${good.name}'s BOM unit differs from its stock unit — it cannot be planned until they match.`)
  }
  if (values.batchWeight !== '' && (!WEIGHT_PATTERN.test(values.batchWeight) || Number(values.batchWeight) <= 0)) {
    fieldErrors.push('Batch weight must be a number greater than zero.')
  }
  if (values.batchCount !== '' && (!COUNT_PATTERN.test(values.batchCount)
    || Number(values.batchCount) < 1 || Number(values.batchCount) > maxBatchCount)) {
    fieldErrors.push(`Number of batches must be a whole number from 1 to ${maxBatchCount}.`)
  }
  if (values.plannedDate !== '' && values.plannedDate < today) {
    fieldErrors.push('The production date cannot be in the past.')
  }

  // Live "Materials required": the server scales the BOM (Decimal), the form
  // only asks. Loading is derived — the result answers an older query — rather
  // than set in the effect, so the effect only ever writes a finished answer.
  const query = previewQuery(values, maxBatchCount)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const previewLoading = query !== null && preview?.query !== query

  useEffect(() => {
    if (query === null) return
    // Wait for typing to pause, and abort an answer that is no longer wanted:
    // a slow response for "10" must not overwrite the one for "10.5".
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/production-orders/requirements?${query}`, { signal: controller.signal })
        const body = await response.json().catch(() => null)
        setPreview(response.ok
          ? { query, data: body.requirements }
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

  const total = plannedTotal(values.batchWeight, values.batchCount)
  const incomplete = !values.finishedGoodId || !values.batchWeight || !values.batchCount
    || !values.plannedDate || !values.branchId

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // requestedById and bomId are deliberately absent: the server takes the
    // requester from the x-user-id header and pins the active BOM itself.
    const payload = {
      finishedGoodId: values.finishedGoodId,
      batchWeight:    values.batchWeight,
      batchCount:     Number(values.batchCount),
      plannedDate:    values.plannedDate,
      branchId:       values.branchId,
      notes:          values.notes || null,
    }

    setSubmitting(true)
    try {
      const response = await fetch(
        isEdit ? `/api/production-orders/${productionOrderId}` : '/api/production-orders',
        {
          method:  isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        },
      )

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      router.push(`/production/orders/${body.productionOrder.id}`)
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
        <Field label="Finished good">
          <select
            value={values.finishedGoodId}
            onChange={event => chooseGood(event.target.value)}
            className={inputClass}
          >
            <option value="">Choose a finished good…</option>
            {goods.map(candidate => (
              <option key={candidate.finishedGoodId} value={candidate.finishedGoodId}>
                {candidate.name} ({candidate.code})
              </option>
            ))}
          </select>
          {good && (
            <p className="mt-1 text-xs text-gray-500">
              BOM v{good.bomVersion} · one batch makes {trimDecimal(good.batchSize)} {good.unitAbbreviation}
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

        <Field label={`Batch weight${good ? ` (${good.unitAbbreviation})` : ''}`}>
          <input
            type="text"
            inputMode="decimal"
            value={values.batchWeight}
            onChange={event => update({ batchWeight: event.target.value })}
            placeholder={good ? trimDecimal(good.batchSize) : 'Choose a finished good first'}
            className={inputClass}
          />
        </Field>

        <Field label="Number of batches">
          <input
            type="number"
            min={1}
            max={maxBatchCount}
            step={1}
            value={values.batchCount}
            onChange={event => update({ batchCount: event.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Production date">
          <input
            type="date"
            min={today}
            value={values.plannedDate}
            onChange={event => update({ plannedDate: event.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Planned output">
          <p className="py-2 text-sm font-medium text-gray-800">
            {good && total !== null
              ? <>{values.batchWeight} {good.unitAbbreviation} × {values.batchCount} = {total} {good.unitAbbreviation}</>
              : <span className="text-gray-300">—</span>}
          </p>
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          value={values.notes}
          onChange={event => update({ notes: event.target.value })}
          placeholder="Who it is for, special instructions…"
          className={inputClass}
        />
      </Field>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">Materials required</h2>
        {query === null ? (
          <p className="text-sm text-gray-400">
            Choose a finished good, batch weight and number of batches to see what the run needs.
          </p>
        ) : preview === null ? (
          <p className="text-sm text-gray-400">Calculating…</p>
        ) : 'error' in preview ? (
          <p className="text-sm text-red-600">{preview.error}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-400">
              {preview.data.lines.length} {preview.data.lines.length === 1 ? 'ingredient' : 'ingredients'} from
              BOM v{preview.data.bomVersion}{isEdit && ', the version saving will use'}.
              {' '}Stock is what {preview.data.branchName} holds right now, less what approved or in-progress
              orders there still need.
              {previewLoading && ' Updating…'}
            </p>
            {/* The previous answer stays, dimmed, while the next one loads — no flicker as you type. */}
            <div className={previewLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
              <MaterialRequirementsTable
                lines={preview.data.lines}
                batchWeight={preview.data.batchWeight}
                batchCount={preview.data.batchCount}
                plannedQty={preview.data.plannedQty}
                unitAbbreviation={good?.unitAbbreviation ?? ''}
              />
            </div>
          </>
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
          disabled={incomplete || fieldErrors.length > 0 || submitting}
          className={primaryButtonClass}
        >
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save draft'}
        </button>
        <Link
          href={isEdit ? `/production/orders/${productionOrderId}` : '/production/orders'}
          className={secondaryButtonClass}
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
