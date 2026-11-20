'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FileText } from 'lucide-react'
import type {
  ActionDecision,
  AssistantActionDto,
  ProductionOrderDraftDto,
  PurchaseRequestDraftDto,
} from '@/services/assistant-action.service'
import { formatDateTime, shortDateLabel } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'

const STATUS_STYLE: Record<AssistantActionDto['status'], string> = {
  PROPOSED:  'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  EXPIRED:   'bg-gray-100 text-gray-600',
}

const STATUS_LABEL: Record<AssistantActionDto['status'], string> = {
  PROPOSED:  'not created yet',
  CONFIRMED: 'created',
  CANCELLED: 'cancelled',
  EXPIRED:   'expired',
}

/** What each kind of draft is called on the panel. */
export const ACTION_NAME: Record<AssistantActionDto['type'], { title: string; document: string }> = {
  PURCHASE_REQUEST: { title: 'Draft purchase request', document: 'request' },
  PRODUCTION_ORDER: { title: 'Draft production order', document: 'order' },
}

function PurchaseRequestDraft({ draft }: { draft: PurchaseRequestDraftDto }) {
  return (
    <>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="pb-1 font-medium">Material</th>
            <th className="pb-1 text-right font-medium">Quantity</th>
            <th className="pb-1 text-right font-medium">Est. price</th>
            <th className="pb-1 text-right font-medium">Est. total</th>
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {draft.lines.map(line => (
            <tr key={line.materialCode} className="border-t border-gray-100">
              <td className="py-1">{line.materialName}</td>
              <td className="py-1 text-right tabular-nums">{formatQuantity(line.quantity)} {line.unit}</td>
              <td className="py-1 text-right tabular-nums">{line.estimatedUnitCost === null ? '—' : `${formatPeso(line.estimatedUnitCost)}/${line.unit}`}</td>
              <td className="py-1 text-right tabular-nums">{line.lineTotal === null ? '—' : formatPeso(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-gray-500">
        Estimated total {draft.estimatedTotal === null ? '— (a material has no reference price)' : formatPeso(draft.estimatedTotal)}
        {draft.neededBy && <> · Needed by {shortDateLabel(draft.neededBy)}</>}
      </p>
      {draft.notes && <p className="mt-0.5 text-xs text-gray-500">Note: {draft.notes}</p>}
    </>
  )
}

function ProductionOrderDraft({ draft }: { draft: ProductionOrderDraftDto }) {
  return (
    <>
      <p className="mt-1.5 text-xs text-gray-700">
        <span className="font-medium">{draft.finishedGoodName}</span>
        {' '}· {draft.batchCount} {draft.batchCount === 1 ? 'batch' : 'batches'} × {formatQuantity(draft.batchWeight)} {draft.unit}
        {' '}= {formatQuantity(draft.plannedQty)} {draft.unit} · {shortDateLabel(draft.plannedDate)} · {draft.branchName} · recipe v{draft.bomVersion}
      </p>
      {draft.notes && <p className="mt-0.5 text-xs text-gray-500">Note: {draft.notes}</p>}
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="pb-1 font-medium">Ingredient</th>
            <th className="pb-1 text-right font-medium">Needs</th>
            <th className="pb-1 text-right font-medium">Available</th>
            <th className="pb-1 text-right font-medium">Short</th>
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {draft.requirements.map(line => {
            const short = formatQuantity(line.short) !== '0'
            return (
              <tr key={line.materialName} className={`border-t border-gray-100 ${short ? 'text-red-700' : ''}`}>
                <td className="py-1">{line.materialName}</td>
                <td className="py-1 text-right tabular-nums">{formatQuantity(line.total)} {line.unit}</td>
                <td className="py-1 text-right tabular-nums">{formatQuantity(line.available)} {line.unit}</td>
                <td className="py-1 text-right tabular-nums">{short ? `${formatQuantity(line.short)} ${line.unit}` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={`mt-1.5 text-xs ${draft.shortages > 0 ? 'text-red-700' : 'text-gray-500'}`}>
        {draft.shortages > 0
          ? `${draft.shortages} ${draft.shortages === 1 ? 'ingredient is' : 'ingredients are'} short at ${draft.branchName}`
          : `Enough stock at ${draft.branchName} for every ingredient`}
        {' '}(as of the draft; approved runs count against stock).
      </p>
    </>
  )
}

/**
 * A document the assistant drafted (Week 9 Task 5, I1): what Confirm will
 * create, with Confirm and Cancel. The draft is kept on the server; the
 * buttons send only the decision.
 */
export function AssistantActionPanel({ action, onChange }: {
  action: AssistantActionDto
  onChange: (action: AssistantActionDto) => void
}) {
  const [busy, setBusy]   = useState<ActionDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = ACTION_NAME[action.type]

  async function decide(decision: ActionDecision) {
    if (busy !== null) return
    setBusy(decision)
    setError(null)
    try {
      const response = await fetch(`/api/ai/assistant/actions/${action.id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision }),
      })
      const body: { action?: AssistantActionDto | null; error?: string } | null = await response.json().catch(() => null)
      // Sent on refusals too, so a draft confirmed elsewhere or expired shows as such.
      if (body?.action) onChange(body.action)
      if (!response.ok) setError(body?.error ?? 'Could not save your decision.')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-gray-800">
        <FileText size={14} className="text-purple-600" aria-hidden="true" />
        {name.title}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[action.status]}`}>{STATUS_LABEL[action.status]}</span>
      </p>

      {action.type === 'PURCHASE_REQUEST'
        ? <PurchaseRequestDraft draft={action.draft} />
        : <ProductionOrderDraft draft={action.draft} />}

      {action.status === 'PROPOSED' && (
        <>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void decide('confirm')} disabled={busy !== null} className={primaryButtonClass}>
              {busy === 'confirm' ? 'Creating…' : `Create draft ${name.document}`}
            </button>
            <button type="button" onClick={() => void decide('cancel')} disabled={busy !== null} className={secondaryButtonClass}>
              Cancel
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Nothing is created until you confirm. It is saved as a draft under your name, for you to submit for approval.
            Confirm by {formatDateTime(action.expiresAt)}.
          </p>
        </>
      )}
      {action.status === 'CONFIRMED' && action.document && (
        <p className="mt-2 text-xs text-gray-600">
          Created <Link href={action.document.href} className="font-medium text-orange-600 hover:underline">{action.document.number}</Link> as
          a draft. Open it to check it and submit it for approval.
        </p>
      )}
      {action.status === 'CANCELLED' && <p className="mt-2 text-xs text-gray-500">Cancelled. Nothing was created.</p>}
      {action.status === 'EXPIRED' && <p className="mt-2 text-xs text-gray-500">Expired. Nothing was created; ask again for a new draft.</p>}

      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
