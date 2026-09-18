import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso, trimDecimal } from '@/lib/format'
import { SupplierRepository } from '@/repositories/supplier.repository'
import { PurchaseOrderForm } from '@/components/procurement/PurchaseOrderForm'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PurchaseOrderDetailPage({ params }: PageProps) {
  const { id } = await params

  const result = await PurchaseOrderService.getById(id)
  if (!result.success) notFound()

  const po = result.data
  const isDraft = po.status === 'DRAFT'
  const suppliers = isDraft ? await SupplierRepository.findAllActive() : []

  return (
    <div>
      <Link
        href="/procurement/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Purchase Orders
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{po.poNumber}</h1>
          <StatusBadge status={po.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Created {po.createdAt.slice(0, 10)}
          {po.prNumber && po.purchaseRequestId && (
            <>
              {' · from '}
              <Link
                href={`/procurement/requests/${po.purchaseRequestId}`}
                className="font-mono text-orange-600 hover:underline"
              >
                {po.prNumber}
              </Link>
            </>
          )}
        </p>
      </div>

      {/* The supplier block is the whole point of this screen while a PO is a
          draft: until it is filled in, the order cannot be sent to anyone. */}
      {isDraft ? (
        <PurchaseOrderForm
          purchaseOrderId={po.id}
          suppliers={suppliers}
          currentSupplierId={po.supplierId}
          currentExpectedDelivery={po.expectedDelivery?.slice(0, 10) ?? ''}
          currentNotes={po.notes ?? ''}
        />
      ) : (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</p>
          <div className="space-y-0.5 text-sm">
            <p className="font-medium text-gray-800">{po.supplierName}</p>
            {po.supplierEmail && <p className="text-gray-500">{po.supplierEmail}</p>}
            {po.supplierPhone && <p className="text-gray-500">{po.supplierPhone}</p>}
            {po.supplierAddress && <p className="text-gray-500">{po.supplierAddress}</p>}
          </div>
          <p className="mt-3 text-sm text-gray-500">
            Expected delivery:{' '}
            <span className="text-gray-700">{po.expectedDelivery?.slice(0, 10) ?? 'not set'}</span>
          </p>
        </div>
      )}

      {po.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{po.notes}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Material</th>
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Unit cost</th>
              <th className="px-4 py-3 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {po.lines.map(line => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <p className="text-gray-700">{line.materialName}</p>
                  <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {trimDecimal(line.quantity)}{' '}
                  <span className="text-gray-400">{line.unitAbbreviation}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{formatPeso(line.unitCost)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{formatPeso(line.totalCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-right text-sm text-gray-500">
                {po.supplierName === null ? 'Estimated total' : 'Order total'}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                {formatPeso(po.totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
