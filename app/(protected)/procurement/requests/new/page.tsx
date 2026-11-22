import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { MaterialService } from '@/services/material.service'
import { ProductionOrderService } from '@/services/production-order.service'
import { ReorderService } from '@/services/reorder.service'
import { shortDateLabel } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { PurchaseRequestForm, type PurchaseRequestFormInitial } from '@/components/procurement/PurchaseRequestForm'

type PageProps = {
  searchParams: Promise<{ productionOrder?: string; reorder?: string }>
}

export default async function NewPurchaseRequestPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { productionOrder, reorder } = await searchParams

  // Server Component: calls the service directly instead of fetching its own
  // API route (docs/architecture.md). Every Decimal is already a string by the
  // time it lands here, which is what makes it safe to pass to a Client
  // Component as a prop.
  //
  // ?productionOrder= pre-fills the shortfall of a production order ("Request
  // missing materials" for production; the link in procurement's "approved —
  // short on …" notification, Week 5 Task 5). Only for those roles: anything
  // else — another role, an unknown id, nothing short — is the empty form.
  const canReadProduction = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'
    || session.role === 'PROCUREMENT_MANAGER'
  //
  // ?reorder=<branchId>:<materialId> pre-fills the Reorder Recommender's order
  // from the stock map (Week 10 Task 4, P8), worked out again now — every
  // role allowed here may open it. Nothing is created until Save.
  const [{ materials }, shortfall, reorderPrefill] = await Promise.all([
    MaterialService.list({ take: 200 }),
    productionOrder && canReadProduction ? ProductionOrderService.shortfallRequest(productionOrder) : null,
    !productionOrder && reorder ? ReorderService.purchaseRequestPrefill(reorder) : null,
  ])

  // Only materials the picker offers: a line whose material is missing from it
  // would show a blank select while still holding the id.
  const offered = new Set(materials.map(material => material.id))
  const prefill = shortfall ?? reorderPrefill
  const initial: PurchaseRequestFormInitial | undefined = prefill
    ? { neededBy: prefill.neededBy, notes: prefill.notes, lines: prefill.lines.filter(line => offered.has(line.materialId)) }
    : undefined
  const rec = reorderPrefill?.recommendation

  return (
    <div>
      <Link
        href="/procurement/requests"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Purchase Requests
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">New Purchase Request</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Pick materials and quantities. Costs are estimated from the current reference price.
      </p>

      {shortfall && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pre-filled with what{' '}
          <Link href={`/production/orders/${shortfall.productionOrderId}`} className="font-mono font-medium underline">
            {shortfall.orderNumber}
          </Link>
          {' '}is short of, at exactly the short quantities. Round up or add to them as you need, then save.
        </p>
      )}
      {rec && (
        <p className="mb-6 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          Pre-filled with KitchenAI&apos;s reorder for <span className="font-medium">{rec.branchName}</span>:{' '}
          {trimDecimal(rec.recommendedQty)} {rec.unit} of {rec.materialName}, order by {shortDateLabel(rec.orderBy)}
          {rec.runOutDate && <>, needed by {shortDateLabel(rec.neededBy)}</>}. Keep the kitchen&apos;s name in the notes —
          the stock map reads it to count this request as on order there. Change anything you need, then save.
        </p>
      )}

      <PurchaseRequestForm materials={materials} initial={initial} />
    </div>
  )
}