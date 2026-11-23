import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReportService } from '@/services/report.service'
import { renderReportPdf } from '@/lib/report-pdf'
import { reportFileName } from '@/lib/report-format'
import { reportToXlsx } from '@/lib/xlsx'

// react-pdf needs Node (fonts, streams), as the purchase order PDF.
export const runtime = 'nodejs'

const QuerySchema = z.object({
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  preset: z.string().max(20).optional(),
  from:   z.string().max(10).optional(),
  to:     z.string().max(10).optional(),
  // A one-day report's date (the End-of-Day Snapshot, Task 6).
  date:   z.string().max(10).optional(),
  branch: z.string().cuid().optional(),
})

type RouteContext = { params: Promise<{ key: string }> }

/**
 * One report (Week 11 Task 4), generated now: `format=json` (the default),
 * `xlsx` (Excel) or `pdf`, for `preset`
 * (last-week …) or `from`–`to`, optionally one `branch`. Who may open which report is checked in ReportService; the
 * /api/reports guard in middleware admits the roles with any report.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { format, preset, from, to, date, branch } = parsed.data
    const { key } = await params

    const result = await ReportService.run(key, { preset, from, to, date, branchId: branch }, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const report = result.data

    if (format === 'xlsx') {
      return new NextResponse(new Uint8Array(await reportToXlsx(report)), {
        headers: {
          'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${reportFileName(report, 'xlsx')}"`,
        },
      })
    }
    if (format === 'pdf') {
      return new NextResponse(new Uint8Array(await renderReportPdf(report)), {
        headers: {
          'Content-Type':        'application/pdf',
          'Content-Disposition': `inline; filename="${reportFileName(report, 'pdf')}"`,
        },
      })
    }
    return NextResponse.json({ report })
  } catch (err) {
    console.error('[GET /api/reports/[key]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
