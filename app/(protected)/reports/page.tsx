import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { ReportService } from '@/services/report.service'

/**
 * Reports (Week 11): the reports this role may open. Each opens on last week
 * and downloads as Excel or PDF.
 */
export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const reports = ReportService.list({ userId: session.userId, role: session.role })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
        <p className="mt-1 text-sm text-gray-400">
          Generated when you open them, from the same figures as the rest of the system. Each downloads as Excel or PDF.
        </p>
      </div>
      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400">No reports for your role yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {reports.map(report => (
            <Link key={report.key} href={`/reports/${report.key}`} className="rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-orange-300 hover:bg-orange-50/40">
              <h2 className="font-semibold text-gray-800">{report.title}</h2>
              <p className="mt-1 text-sm text-gray-500">{report.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
