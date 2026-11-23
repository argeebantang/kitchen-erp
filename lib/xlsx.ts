import ExcelJS from 'exceljs'
import type { ReportCell, ReportDto, ReportTableDto, ReportValueKind } from '@/services/report.service'

/**
 * A report as an Excel workbook (Week 11 Task 4) — the spreadsheet download
 * (the owner chose Excel over CSV, 2026-11-23). A Summary sheet (title, period,
 * figures, notes), then one sheet per table with a bold frozen header, filter
 * buttons, sized columns and a bold total row. Values are real Excel numbers
 * and dates with number formats, so they sort, filter and sum.
 *
 * NODE ONLY (exceljs uses streams): called from the report route, never from
 * a Client Component.
 *
 * Numbers go in as JavaScript numbers — Excel itself stores doubles. The
 * values are already rounded (money to the centavo, quantities as recorded),
 * so nothing is recalculated here.
 */

const ACCENT = 'FFEA580C'
const HEADER_FILL = 'FF1F2937'
const TOTAL_FILL = 'FFF3F4F6'
const MUTED = 'FF6B7280'

const NUMBER_FORMATS: Partial<Record<ReportValueKind, string>> = {
  peso:     '"₱"#,##0.00;[Red]-"₱"#,##0.00',
  quantity: '#,##0.000',
  count:    '#,##0',
  // The value is already a percentage (98.4), so the % is a literal.
  percent:  '0.0"%"',
  date:     'ddd, mmm d, yyyy',
}

/**
 * Alignment by kind (owner, 2026-11-23: an unaligned sheet looked uneven).
 * Money and quantities right, so the decimal points line up; short values —
 * counts, yield, dates — centred; names left. A header aligns with its column.
 */
const ALIGNMENT: Record<ReportValueKind, 'left' | 'center' | 'right'> = {
  text: 'left', date: 'center', count: 'center', percent: 'center', quantity: 'right', peso: 'right',
}

/** A cell's Excel value: numbers as numbers, YYYY-MM-DD as a date, the rest as text. */
function excelValue(value: ReportCell, kind: ReportValueKind): ExcelJS.CellValue {
  if (value === null || value === '') return null
  if (kind === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`)
  if (kind === 'peso' || kind === 'quantity' || kind === 'count' || kind === 'percent') {
    const number = Number(value)
    return Number.isFinite(number) ? number : String(value)
  }
  return String(value)
}

/** Excel sheet names: ≤ 31 characters, none of []:*?/\, unique in the workbook. */
function sheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
  taken.add(name.toLowerCase())
  return name
}

/** About how wide a value shows, for sizing its column. */
function shownLength(value: ReportCell, kind: ReportValueKind): number {
  if (value === null) return 1
  if (kind === 'date') return 17
  if (kind === 'peso') return String(value).length + 5
  return String(value).length + (kind === 'count' || kind === 'quantity' ? 2 : 0)
}

function addTableSheet(workbook: ExcelJS.Workbook, table: ReportTableDto, report: ReportDto, taken: Set<string>): void {
  const sheet = workbook.addWorksheet(sheetName(table.title, taken), {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { orientation: table.columns.length >= 8 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })

  // Rows 1–2: what this is. Row 3: the header.
  sheet.getCell('A1').value = `${report.title} — ${table.title}`
  sheet.getCell('A1').font = { bold: true, size: 13, color: { argb: ACCENT } }
  sheet.getCell('A2').value = `${report.periodLabel} · ${report.branchName ?? 'All'}${table.description ? ` — ${table.description}` : ''}`
  sheet.getCell('A2').font = { italic: true, color: { argb: MUTED } }

  const header = sheet.getRow(3)
  table.columns.forEach((column, index) => {
    const cell = header.getCell(index + 1)
    cell.value = column.label
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: ALIGNMENT[column.kind] }
  })

  if (table.rows.length === 0) {
    sheet.getCell('A4').value = table.emptyText
    sheet.getCell('A4').font = { italic: true, color: { argb: MUTED } }
  }
  table.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(4 + rowIndex)
    table.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1)
      cell.value = excelValue(row[column.key] ?? null, column.kind)
      const format = NUMBER_FORMATS[column.kind]
      if (format) cell.numFmt = format
      cell.alignment = { horizontal: ALIGNMENT[column.kind] }
    })
  })

  if (table.total && table.rows.length > 0) {
    const total = table.total
    const excelRow = sheet.getRow(4 + table.rows.length)
    table.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1)
      // The first column holds "Total", whatever the column's kind.
      cell.value = excelValue(total[column.key] ?? null, index === 0 ? 'text' : column.kind)
      const format = index === 0 ? undefined : NUMBER_FORMATS[column.kind]
      if (format) cell.numFmt = format
      cell.alignment = { horizontal: index === 0 ? 'left' : ALIGNMENT[column.kind] }
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
      cell.border = { top: { style: 'thin' } }
    })
  }

  // Filter buttons on the header, over the rows (not the total).
  if (table.rows.length > 0) {
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + table.rows.length, column: table.columns.length } }
  }

  table.columns.forEach((column, index) => {
    const longest = Math.max(
      column.label.length,
      ...table.rows.map(row => shownLength(row[column.key] ?? null, column.kind)),
      table.total ? shownLength(table.total[column.key] ?? null, column.kind) : 0,
    )
    sheet.getColumn(index + 1).width = Math.min(Math.max(longest + 2, 10), 48)
  })
}

export async function reportToXlsx(report: ReportDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'KitchenERP'
  workbook.created = new Date(report.generatedAt)
  const taken = new Set<string>(['summary'])

  const summary = workbook.addWorksheet('Summary', { pageSetup: { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  summary.getColumn(1).width = 30
  summary.getColumn(2).width = 22
  summary.getColumn(3).width = 60
  summary.getCell('A1').value = report.title
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: ACCENT } }

  const facts: [string, ExcelJS.CellValue][] = [
    ['Period', report.periodLabel],
    ['Branch', report.branchName ?? 'All'],
    ['Generated (Manila)', new Date(report.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })],
  ]
  facts.forEach(([label, value], index) => {
    summary.getCell(3 + index, 1).value = label
    summary.getCell(3 + index, 1).font = { color: { argb: MUTED } }
    summary.getCell(3 + index, 2).value = value
  })

  const figuresTop = 3 + facts.length + 1
  const head = summary.getRow(figuresTop)
  ;['Figure', 'Value', 'Note'].forEach((label, index) => {
    const cell = head.getCell(index + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  })
  report.figures.forEach((figure, index) => {
    const row = summary.getRow(figuresTop + 1 + index)
    row.getCell(1).value = figure.label
    const value = row.getCell(2)
    value.value = excelValue(figure.value, figure.kind)
    const format = NUMBER_FORMATS[figure.kind]
    if (format) value.numFmt = format
    value.font = { bold: true }
    // Every figure right-aligned: one column of mixed money and counts reads best lined up on the right.
    value.alignment = { horizontal: 'right' }
    row.getCell(3).value = figure.note ?? null
    row.getCell(3).font = { color: { argb: MUTED } }
  })

  let next = figuresTop + report.figures.length + 2
  summary.getCell(next, 1).value = 'Sheets'
  summary.getCell(next, 1).font = { bold: true }
  report.tables.forEach(table => { summary.getCell(++next, 1).value = table.title })
  next += 2
  report.notes.forEach(note => {
    const cell = summary.getCell(next++, 1)
    cell.value = note
    cell.font = { italic: true, color: { argb: MUTED } }
  })

  for (const table of report.tables) addTableSheet(workbook, table, report, taken)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
