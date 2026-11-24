import { reportDocument } from '@/components/pdf/ReportDocument'
import { applyPdfDefaults } from '@/components/pdf/setup'
import type { ReportDto } from '@/services/report.service'

/**
 * A report as PDF bytes (Week 11 Task 6) — the report route and the emails
 * the worker sends both render through here.
 *
 * NODE ONLY. @react-pdf/renderer is ESM-only and is loaded with import():
 * the worker runs under tsx as CommonJS, where a static import becomes a
 * require() that fails (ERR_PACKAGE_PATH_NOT_EXPORTED in its hyphenation
 * package) — which would stop the worker at startup. ReportDocument takes the
 * library as an argument for the same reason.
 */
export async function renderReportPdf(report: ReportDto): Promise<Buffer> {
  const pdf = await import('@react-pdf/renderer')
  applyPdfDefaults(pdf.Font)
  return pdf.renderToBuffer(reportDocument(pdf, report))
}
