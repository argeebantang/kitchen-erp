import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { EndOfDayService, endOfDayDate, type EndOfDayDocumentDto, type EndOfDayFigureDto } from '@/services/end-of-day.service'
import { BranchRepository } from '@/repositories/branch.repository'

type PageProps = {
  searchParams: Promise<{ date?: string; branch?: string }>
}

/**
 * End of Day (Week 7 Task 4, E3): one business day of finished goods per
 * branch — opening, produced, converted in and out, written off, distributed,
 * closing — from the ledger. Every signed-in role, like Finished Goods.
 */
export default async function EndOfDayPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // A missing, malformed or future date shows today.
  const { date: dateParam, branch = '' } = await searchParams
  const date = endOfDayDate(dateParam)

  const [day, branchOptions] = await Promise.all([
    EndOfDayService.forDay(date, branch || null, { role: session.role }),
    BranchRepository.findAllActive(),
  ])

  const dayHref = (target: string) => {
    const query = new URLSearchParams({ date: target })
    if (branch) query.set('branch', branch)
    return `/inventory/end-of-day?${query.toString()}`
  }
  const heading = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const unbalanced = day.rows.filter(row => !row.balanced || row.matchesStock === false)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">End of Day</h1>
        <p className="mt-1 text-sm text-gray-400">
          Finished goods for one day, per branch: what was there in the morning, what was produced, converted, written off
          and distributed, and what is left — from the stock ledger, at each lot&apos;s cost. A movement counts on the day
          accounting approved it, which is when it reached the books.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Link href={dayHref(day.previousDate)} className={`inline-flex items-center gap-1 ${secondaryButtonClass}`} title="Previous day">
          <ChevronLeft size={16} /> {day.previousDate}
        </Link>
        {/* A GET form: the day and branch live in the URL, so a day can be linked to. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Day</span>
            <input type="date" name="date" defaultValue={day.date} max={day.isToday ? day.date : undefined} className={inputClass} />
          </label>
          <label className="block min-w-48">
            <span className="mb-1 block text-xs font-medium text-gray-500">Branch</span>
            <select name="branch" defaultValue={branch} className={inputClass}>
              <option value="">All branches</option>
              {branchOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={primaryButtonClass}>Show</button>
        </form>
        {day.nextDate !== null && (
          <Link href={dayHref(day.nextDate)} className={`inline-flex items-center gap-1 ${secondaryButtonClass}`} title="Next day">
            {day.nextDate} <ChevronRight size={16} />
          </Link>
        )}
        {!day.isToday && <Link href={branch ? `/inventory/end-of-day?branch=${branch}` : '/inventory/end-of-day'} className={secondaryButtonClass}>Today</Link>}
      </div>

      <h2 className="mb-3 text-lg font-semibold text-gray-800">
        {heading}{day.isToday && <span className="ml-2 text-sm font-normal text-gray-400">today, so far</span>}
      </h2>

      {day.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No finished goods on the books this day</p>
          <p className="mt-1 text-sm text-gray-400">Nothing was on hand, and nothing was produced, converted or written off.</p>
        </div>
      ) : (
        <>
          {unbalanced.length > 0 ? (
            <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {unbalanced.length} {unbalanced.length === 1 ? 'row does' : 'rows do'} not reconcile — see the Check column. The
              ledger has a movement this page does not recognise, or a stock level differs from its ledger; the daily stock
              reconciliation names it.
            </p>
          ) : (
            <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Every row reconciles: opening + the day&apos;s movements = closing
              {day.isToday && <>, and closing = what the stock levels hold now</>}.
              {' '}{day.movementCount} {day.movementCount === 1 ? 'movement' : 'movements'} this day.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Finished good</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 text-right font-medium">Opening</th>
                  <th className="px-4 py-3 text-right font-medium">Produced</th>
                  <th className="px-4 py-3 text-right font-medium">Converted in</th>
                  <th className="px-4 py-3 text-right font-medium">Converted out</th>
                  <th className="px-4 py-3 text-right font-medium">Written off</th>
                  <th className="px-4 py-3 text-right font-medium" title="Transfers between branches — Week 8">Distributed</th>
                  <th className="px-4 py-3 text-right font-medium">Closing</th>
                  <th className="px-4 py-3 font-medium">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {day.rows.map(row => (
                  <tr key={`${row.finishedGoodId}:${row.branchId}`} className={!row.balanced || row.matchesStock === false ? 'bg-red-50/60' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-800">
                      {row.finishedGoodName} <span className="font-mono text-xs text-gray-400">{row.finishedGoodCode}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
                    <Cell figure={row.opening} unit={row.unitAbbreviation} plain />
                    <Cell figure={row.produced} unit={row.unitAbbreviation} />
                    <Cell figure={row.convertedIn} unit={row.unitAbbreviation} />
                    <Cell figure={row.convertedOut} unit={row.unitAbbreviation} />
                    <Cell figure={row.writtenOff} unit={row.unitAbbreviation} />
                    <Cell figure={row.distributed} unit={row.unitAbbreviation} />
                    <Cell figure={row.closing} unit={row.unitAbbreviation} plain bold />
                    <td className="px-4 py-3">
                      {row.balanced && row.matchesStock !== false ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">✓</span>
                      ) : (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                          {!row.balanced ? `Unrecognised ${formatQuantity(row.other.quantity)}` : 'Stock differs'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-200 bg-gray-50 text-gray-700">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-sm font-medium">Value at cost</td>
                  <TotalCell value={day.totals.opening} />
                  <TotalCell value={day.totals.produced} signed />
                  <TotalCell value={day.totals.convertedIn} signed />
                  <TotalCell value={day.totals.convertedOut} signed />
                  <TotalCell value={day.totals.writtenOff} signed />
                  <TotalCell value={day.totals.distributed} signed />
                  <TotalCell value={day.totals.closing} bold />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Distributed is transfers between branches, which arrive with Week 8. Sales are not recorded, so closing is what the
            books say is left, not a count.
          </p>

          <Documents documents={day.documents} />
        </>
      )}
    </div>
  )
}

const FLOW_LABELS: Record<EndOfDayDocumentDto['flow'], { label: string; className: string }> = {
  produced:     { label: 'Produced',      className: 'bg-emerald-50 text-emerald-700' },
  convertedIn:  { label: 'Converted in',  className: 'bg-emerald-50 text-emerald-700' },
  convertedOut: { label: 'Converted out', className: 'bg-amber-50 text-amber-700' },
  writtenOff:   { label: 'Written off',   className: 'bg-red-50 text-red-700' },
  distributed:  { label: 'Distributed',   className: 'bg-sky-50 text-sky-700' },
  other:        { label: 'Unrecognised',  className: 'bg-red-100 text-red-700' },
}

/**
 * The documents behind the figures (E3), in the order the stock moved: each
 * flow's rows add up to its column above. Numbers link for the roles that can
 * open the document; others see the number.
 */
function Documents({ documents }: { documents: EndOfDayDocumentDto[] }) {
  if (documents.length === 0) {
    return <p className="mt-6 text-sm text-gray-400">No documents moved finished goods this day — the figures are the opening balance carried through.</p>
  }
  return (
    <div className="mt-8">
      <h3 className="mb-3 text-base font-semibold text-gray-800">Documents behind the figures ({documents.length})</h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Stock moved</th>
              <th className="px-4 py-3 font-medium">Document</th>
              <th className="px-4 py-3 font-medium">Flow</th>
              <th className="px-4 py-3 font-medium">Finished good</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">Lots</th>
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Value at cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documents.map(document => {
              const flow = FLOW_LABELS[document.flow]
              const quantity = formatQuantity(document.quantity)
              const negative = quantity.startsWith('-')
              return (
                <tr key={`${document.source.type}:${document.source.id}:${document.flow}:${document.finishedGoodCode}:${document.branchName}`} className={document.flow === 'other' ? 'bg-red-50/60' : 'hover:bg-gray-50'}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDateTime(document.movedAt)}</td>
                  <td className="px-4 py-3">
                    {document.source.href ? (
                      <Link href={document.source.href} className="font-mono text-xs text-orange-600 hover:underline">
                        {document.source.number ?? document.source.type}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-gray-600">{document.source.number ?? document.source.type}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${flow.className}`}>{flow.label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    {document.finishedGoodName} <span className="font-mono text-xs text-gray-400">{document.finishedGoodCode}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{document.branchName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{document.lotNumbers.join(', ')}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${negative ? 'text-red-700' : 'text-emerald-700'}`}>
                    {negative ? `−${quantity.slice(1)}` : `+${quantity}`} <span className="font-normal text-gray-400">{document.unitAbbreviation}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">
                    {document.value === null ? '—' : <>{negative ? '−' : '+'}{formatPeso(document.value.replace(/^-/, ''))}</>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** "+18 kg" / "−20 kg" (a true minus) / "—" for nothing, with the value under it. */
function Cell({ figure, unit, plain = false, bold = false }: { figure: EndOfDayFigureDto; unit: string; plain?: boolean; bold?: boolean }) {
  const quantity = formatQuantity(figure.quantity)
  if (quantity === '0' && !plain) {
    return <td className="px-4 py-3 text-right text-gray-300">—</td>
  }
  const negative = quantity.startsWith('-')
  const shown = negative ? `−${quantity.slice(1)}` : plain ? quantity : `+${quantity}`
  return (
    <td className={`px-4 py-3 text-right ${bold ? 'font-semibold text-gray-900' : negative ? 'text-red-700' : plain ? 'text-gray-700' : 'text-emerald-700'}`}>
      {shown} <span className="font-normal text-gray-400">{unit}</span>
      <span className="block text-xs font-normal text-gray-400">{formatPeso(figure.value.replace(/^-/, ''))}</span>
    </td>
  )
}

function TotalCell({ value, signed = false, bold = false }: { value: string; signed?: boolean; bold?: boolean }) {
  const negative = value.startsWith('-')
  const zero = formatPeso(value) === '₱0.00'
  return (
    <td className={`px-4 py-3 text-right text-sm ${bold ? 'font-semibold' : ''} ${signed && !zero ? (negative ? 'text-red-700' : 'text-emerald-700') : ''}`}>
      {signed && zero ? <span className="text-gray-300">—</span> : <>{signed ? (negative ? '−' : '+') : ''}{formatPeso(value.replace(/^-/, ''))}</>}
    </td>
  )
}
