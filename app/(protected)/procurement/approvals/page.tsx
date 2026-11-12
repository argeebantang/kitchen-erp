import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ProductionOrderService } from '@/services/production-order.service'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { WriteOffService } from '@/services/write-off.service'
import { WriteOffReasonBadge } from '@/components/inventory/WriteOffReasonBadge'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { VarianceBadge } from '@/components/procurement/VarianceChips'
import { formatPeso, formatQuantity, trimDecimal } from '@/lib/format'

export default async function ApprovalsInboxPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [requests, orders, receiving, productionOrders, completions, conversions, writeOffs] = await Promise.all([
    PurchaseRequestService.list(
      { userId: session.userId, role: session.role },
      { status: 'PENDING_APPROVAL', sort: 'neededBy', take: 100 },
    ),
    PurchaseOrderService.list({ status: 'PENDING_APPROVAL', take: 100 }),
    ReceivingReportService.list({ status: 'PENDING_APPROVAL', take: 100 }),
    ProductionOrderService.listPending(100),
    ProductionOrderService.listPendingCompletions(100),
    ConversionOrderService.listPending(100),
    WriteOffService.listPending(100),
  ])

  const { purchaseRequests,  total: requestTotal }   = requests
  const { purchaseOrders,    total: orderTotal }     = orders
  const { receivingReports,  total: receivingTotal } = receiving
  const waiting = [
    { count: requestTotal,   noun: 'purchase request' },
    { count: orderTotal,     noun: 'purchase order' },
    { count: receivingTotal, noun: 'receiving report' },
    { count: productionOrders.length, noun: 'production order' },
    { count: completions.length, noun: 'production completion' },
    { count: conversions.length, noun: 'conversion' },
    { count: writeOffs.length, noun: 'write-off' },
  ].filter(part => part.count > 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Approvals</h1>
        <p className="mt-1 text-sm text-gray-400">
            {waiting.length === 0
            ? 'Nothing is waiting for approval.'
            : `${waiting.map(part => `${part.count} ${part.noun}${part.count === 1 ? '' : 's'}`).join(', ')} waiting for a decision. Open one to review its lines before deciding.`}
        </p>
      </div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Purchase requests</h2>
      {purchaseRequests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">Inbox clear</p>
          <p className="mt-1 text-sm text-gray-400">Submitted requests will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Requested by</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Est. total</th>
                <th className="px-4 py-3 font-medium">Needed by</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseRequests.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/requests/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.prNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.requesterName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.estimatedTotal === null
                      ? <span className="text-gray-400">Not priced</span>
                      : formatPeso(row.estimatedTotal)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.neededBy?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Purchase orders</h2>

      {purchaseOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No purchase orders waiting</p>
          <p className="mt-1 text-sm text-gray-400">Orders procurement submits will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">From request</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Expected delivery</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseOrders.map(po => (
                <tr key={po.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/orders/${po.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{po.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{po.prNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{po.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">{formatPeso(po.totalAmount)}</td>
                  <td className="px-4 py-3 text-gray-500">{po.expectedDelivery?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={po.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Receiving reports</h2>

      {receivingReports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No receiving reports waiting</p>
          <p className="mt-1 text-sm text-gray-400">Deliveries procurement submits will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Counted by</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Accepted value</th>
                <th className="px-4 py-3 font-medium">Variance</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receivingReports.map(rr => (
                <tr key={rr.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/receiving/${rr.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {rr.rrNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{rr.poNumber}</td>
                  <td className="px-4 py-3 text-gray-700">{rr.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{rr.receivedByName}</td>
                  <td className="px-4 py-3 text-gray-500">{rr.receivedAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatPeso(rr.acceptedValue)}</td>
                  <td className="px-4 py-3">
                    <VarianceBadge varianceLineCount={rr.varianceLineCount} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={rr.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Production orders</h2>

      {productionOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No production orders waiting</p>
          <p className="mt-1 text-sm text-gray-400">Runs production submits will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Finished good</th>
                <th className="px-4 py-3 font-medium">Planned</th>
                <th className="px-4 py-3 font-medium">Production date</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Submitted by</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productionOrders.map(order => (
                <tr key={order.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/orders/${order.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{order.finishedGoodName}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {trimDecimal(order.plannedQty)} <span className="text-gray-400">{order.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{order.plannedDate}</td>
                  <td className="px-4 py-3 text-gray-500">{order.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{order.submittedByName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {/* Right now, at the order's branch — the order page lists which. */}
                    {order.shortCount === 0 ? (
                      <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">In stock</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        Short · {order.shortCount} of {order.ingredientCount}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Week 6 Task 2, D9: runs the kitchen reported done. Approving moves the stock. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Production completions</h2>

      {completions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No completions waiting</p>
          <p className="mt-1 text-sm text-gray-400">Runs the kitchen reports done will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Finished good</th>
                <th className="px-4 py-3 font-medium">Yield</th>
                <th className="px-4 py-3 text-right font-medium">Unit cost</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Reported by</th>
                <th className="px-4 py-3 font-medium">Stock after</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {completions.map(order => (
                <tr key={order.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/orders/${order.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{order.finishedGoodName}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {trimDecimal(order.actualQty)} <span className="text-gray-400">of {trimDecimal(order.plannedQty)} {order.unitAbbreviation} ({order.percentOfPlan}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {/* What approving records; the order page has the breakdown. */}
                    {order.costPerUnit === null ? (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">Price missing</span>
                    ) : (
                      <>{formatPeso(order.costPerUnit)}<span className="text-gray-400">/{order.unitAbbreviation}</span></>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{order.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{order.completedByName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {/* What approving would leave at the branch — the order page lists each ingredient. */}
                    {order.negativeCount === 0 ? (
                      <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">All in stock</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        {order.negativeCount} of {order.ingredientCount} go negative
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Week 7 Task 1, D9: conversions recorded by production. Approving moves the stock. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Conversions</h2>

      {conversions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No conversions waiting</p>
          <p className="mt-1 text-sm text-gray-400">Conversions production records will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Made</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 text-right font-medium">Unit cost</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Recorded by</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conversions.map(order => (
                <tr key={order.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/conversions/${order.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatQuantity(order.outputQty)} <span className="text-gray-400">{order.unitAbbreviation}</span> {order.finishedGoodName}
                    <span className="text-gray-400"> ({order.percentOfExpected}%)</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatQuantity(order.sourceQty)} <span className="text-gray-400">{order.sourceUnitAbbreviation}</span> {order.sourceName}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {/* What approving records; the conversion page has the breakdown. */}
                    {order.missingPrices > 0 ? (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">Price missing</span>
                    ) : order.costPerUnit === null ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <>{formatPeso(order.costPerUnit)}<span className="text-gray-400">/{order.unitAbbreviation}</span></>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{order.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{order.submittedByName}</td>
                  <td className="px-4 py-3">
                    {/* Right now: the source must be there to approve; ingredients may go negative. */}
                    {!order.sourceEnough ? (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        {order.sourceName} short
                      </span>
                    ) : order.negativeCount === 0 ? (
                      <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">All in stock</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                        {order.negativeCount} of {order.ingredientCount} go negative
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Week 7 Task 2, W8: write-offs recorded by production. Approving takes them out of stock at the lot's cost. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Write-offs</h2>

      {writeOffs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No write-offs waiting</p>
          <p className="mt-1 text-sm text-gray-400">Write-offs production records will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Finished good · lot</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Recorded by</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {writeOffs.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/inventory/write-offs/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.writeOffNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.finishedGoodName} <span className="font-mono text-xs text-gray-400">{row.lotNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatQuantity(row.quantity)} <span className="text-gray-400">{row.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3"><WriteOffReasonBadge reason={row.reason} label={row.reasonLabel} /></td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {/* What approving records, at the lot's cost. */}
                    {row.value === null ? <span className="text-gray-400">—</span> : formatPeso(row.value)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.submittedByName}</td>
                  <td className="px-4 py-3">
                    {row.enough ? (
                      <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Lot holds it</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">Lot short</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}