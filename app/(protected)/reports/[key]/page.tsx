import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { ReportService } from '@/services/report.service'
import { ReportFilters } from '@/components/reports/ReportFilters'
import { ReportView } from '@/components/reports/ReportView'
import { secondaryButtonClass } from '@/components/ui/form'

type PageProps = {
  params: Promise<{ key: string }>
  searchParams: Promise<{ preset?: string; from?: string; to?: string; date?: string; branch?: string }>
}

/**
 * One report (Week 11 Task 4): the filters, the report itself, and Excel / PDF
 * downloads of exactly what is shown (the same query to /api/reports).
 */
export default async function ReportPage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const viewer = { userId: session.userId, role: session.role }

  const { key } = await params
  const query = await searchParams
  const options = await ReportService.options(key, viewer)
  if (!options.success) {
    if (options.status === 404) notFound()
    // A branch manager with no branch yet may open the report — say why it is empty.
    if (options.error.startsWith('You do not manage')) {
      return (
        <div>
          <Link href="/reports" className="text-sm text-orange-600 hover:underline">← Reports</Link>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{options.error}</p>
        </div>
      )
    }
    redirect('/unauthorized')
  }

  const result = await ReportService.run(key, { preset: query.preset, from: query.from, to: query.to, date: query.date, branchId: query.branch }, viewer)
  const download = (format: 'xlsx' | 'pdf') => {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    params.set('format', format)
    return `/api/reports/${key}?${params.toString()}`
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/reports" className="text-sm text-orange-600 hover:underline">← Reports</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-800">{options.data.title}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {result.success ? `${result.data.periodLabel} · ${result.data.branchName ?? options.data.allLabel}` : options.data.description}
          </p>
        </div>
        {result.success && (
          <div className="flex gap-2">
            <a href={download('xlsx')} className={secondaryButtonClass}>Download Excel</a>
            <a href={download('pdf')} target="_blank" rel="noopener" className={secondaryButtonClass}>Open PDF</a>
          </div>
        )}
      </div>

      <ReportFilters
        reportKey={key}
        presets={options.data.presets}
        branches={options.data.branches}
        branchLabel={options.data.branchLabel}
        branchFixed={options.data.branchFixed}
        maxDays={options.data.maxDays}
        singleDay={options.data.singleDay}
        current={{
          // An unknown preset falls back to the default, as the report itself does.
          preset:   query.from || query.to || query.date ? null : (options.data.presets.find(option => option.value === query.preset)?.value ?? options.data.presets[0].value),
          from:     result.success ? result.data.from : (query.from ?? ''),
          to:       result.success ? result.data.to : (query.to ?? ''),
          branchId: options.data.branchFixed ? (options.data.branches[0]?.id ?? null) : (query.branch ?? null),
        }}
      />

      <div className="mt-6">
        {result.success
          ? <ReportView report={result.data} />
          : <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{result.error}</p>}
      </div>
    </div>
  )
}
