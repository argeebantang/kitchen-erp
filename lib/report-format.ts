import type { ReportCell, ReportDto, ReportValueKind } from '@/services/report.service'
import { formatPeso, formatQuantity, trimDecimal } from '@/lib/format'

/**
 * How report values read (Week 11 Task 4) — on the page and in the PDF. No
 * Prisma, no 'use client', so both sides can use it (like lib/format.ts).
 * Rounding is formatPeso's / formatQuantity's (on the digits, half up); this
 * only adds thousands separators, which totals in the millions need.
 */

/** "1234567.89" → "1,234,567.89"; leaves a sign or currency prefix alone. */
export function groupThousands(text: string): string {
  // The first run of digits is the whole part ("₱-1234567.89" → "1234567").
  return text.replace(/\d+/, whole => whole.replace(/\B(?=(\d{3})+$)/g, ','))
}

/** One cell as text. `pdf`: money as "PHP 1,234.50" — the PDF's built-in fonts have no peso sign. */
export function formatReportValue(value: ReportCell, kind: ReportValueKind, target: 'screen' | 'pdf' = 'screen'): string {
  if (value === null || value === '') return '—'
  const text = String(value)
  switch (kind) {
    case 'peso': {
      const formatted = groupThousands(formatPeso(text))
      return target === 'pdf' ? formatted.replace('₱', 'PHP ') : formatted
    }
    case 'quantity': return groupThousands(formatQuantity(text))
    case 'count':    return groupThousands(text)
    case 'percent':  return `${trimDecimal(text)}%`
    case 'date':     return /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      : text
    case 'text':     return text
  }
}

/** Numbers right-aligned, words left. */
export function isNumericKind(kind: ReportValueKind): boolean {
  return kind === 'count' || kind === 'quantity' || kind === 'peso' || kind === 'percent'
}

/** A file name for a report: "production-summary_main-commissary_2026-11-16_2026-11-22.xlsx". */
export function reportFileName(report: Pick<ReportDto, 'key' | 'from' | 'to' | 'branchName'>, extension: 'xlsx' | 'pdf'): string {
  // ASCII only, for the Content-Disposition header: "Las Piñas" → "las-pinas".
  const branch = report.branchName
    ? `_${report.branchName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : ''
  return `${report.key}${branch}_${report.from}_${report.to}.${extension}`
}
