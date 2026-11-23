import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReportColumnDto, ReportDto, ReportTableDto, ReportValueKind } from '@/services/report.service'
import { formatReportValue, isNumericKind } from '@/lib/report-format'

/**
 * Any report as a PDF (Week 11 Task 4) — the same ReportDto the page and the
 * Excel render. @react-pdf/renderer primitives, server only (renderToBuffer in
 * the route), like components/pdf/PurchaseOrderDocument.tsx.
 *
 * The built-in Helvetica covers Latin-1 (ñ, é, —, ·) but not the peso sign or
 * a true minus, so money prints "PHP 1,234.50" (lib/report-format) and
 * pdfText() swaps the few other characters the reports use.
 */
const COMPANY_NAME = 'KitchenERP'

const COLOR_TEXT   = '#1f2937'
const COLOR_MUTED  = '#6b7280'
const COLOR_RULE   = '#d1d5db'
const COLOR_SHADE  = '#f3f4f6'
const COLOR_ACCENT = '#ea580c'

/** A table this wide goes on a landscape page. */
const LANDSCAPE_FROM_COLUMNS = 8

/** Relative widths by kind: names get room, a unit very little. */
const WIDTH_WEIGHT: Record<ReportValueKind, number> = {
  text: 3, date: 2, count: 1.3, quantity: 1.6, peso: 2.2, percent: 1.3,
}

const styles = StyleSheet.create({
  page:         { padding: 32, paddingBottom: 48, fontSize: 9, color: COLOR_TEXT },
  header:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  company:      { fontSize: 12, fontWeight: 'bold', color: COLOR_ACCENT },
  title:        { fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  headerRight:  { alignItems: 'flex-end' },
  muted:        { color: COLOR_MUTED },
  figures:      { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, borderTopWidth: 0.5, borderTopColor: COLOR_RULE },
  figure:       { width: '25%', paddingVertical: 6, paddingRight: 8 },
  figureLabel:  { fontSize: 7, color: COLOR_MUTED, textTransform: 'uppercase' },
  figureValue:  { fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  figureNote:   { fontSize: 7, color: COLOR_MUTED, marginTop: 1 },
  tableTitle:   { fontSize: 11, fontWeight: 'bold', marginTop: 12 },
  tableNote:    { fontSize: 7.5, color: COLOR_MUTED, marginTop: 2, marginBottom: 4 },
  head:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLOR_TEXT, paddingBottom: 3, fontSize: 7, color: COLOR_MUTED, textTransform: 'uppercase' },
  row:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLOR_RULE, paddingVertical: 3 },
  totalRow:     { flexDirection: 'row', backgroundColor: COLOR_SHADE, paddingVertical: 3, fontWeight: 'bold' },
  cell:         { paddingRight: 4 },
  empty:        { paddingVertical: 6, color: COLOR_MUTED },
  notes:        { marginTop: 14, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: COLOR_RULE, fontSize: 7.5, color: COLOR_MUTED },
  footer:       { position: 'absolute', left: 32, right: 32, bottom: 20, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: COLOR_MUTED },
})

/** Characters the built-in font cannot draw, swapped for ones it can. */
export function pdfText(text: string): string {
  return text.replace(/₱/g, 'PHP ').replace(/−/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=')
}

function widths(columns: ReportColumnDto[]): string[] {
  const total = columns.reduce((sum, column) => sum + WIDTH_WEIGHT[column.kind], 0)
  return columns.map(column => `${(WIDTH_WEIGHT[column.kind] / total) * 100}%`)
}

function Table({ table }: { table: ReportTableDto }) {
  const columnWidths = widths(table.columns)
  const cellStyle = (index: number) => [styles.cell, { width: columnWidths[index], textAlign: isNumericKind(table.columns[index].kind) ? 'right' as const : 'left' as const }]
  const small = table.columns.length >= LANDSCAPE_FROM_COLUMNS ? { fontSize: 7.5 } : {}

  return (
    <View>
      {/* minPresenceAhead: a title never sits alone at the foot of a page. */}
      <Text style={styles.tableTitle} minPresenceAhead={48}>{pdfText(table.title)}</Text>
      {table.description && <Text style={styles.tableNote}>{pdfText(table.description)}</Text>}
      <View style={styles.head} wrap={false}>
        {table.columns.map((column, index) => <Text key={column.key} style={cellStyle(index)}>{pdfText(column.label)}</Text>)}
      </View>
      {table.rows.length === 0 && <Text style={styles.empty}>{pdfText(table.emptyText)}</Text>}
      {table.rows.map((row, rowIndex) => (
        // wrap={false}: a row is never split across two pages.
        <View key={rowIndex} style={[styles.row, small]} wrap={false}>
          {table.columns.map((column, index) => (
            <Text key={column.key} style={cellStyle(index)}>{pdfText(formatReportValue(row[column.key] ?? null, column.kind, 'pdf'))}</Text>
          ))}
        </View>
      ))}
      {table.total && (
        <View style={[styles.totalRow, small]} wrap={false}>
          {table.columns.map((column, index) => {
            const value = table.total?.[column.key] ?? null
            return <Text key={column.key} style={cellStyle(index)}>{value === null ? '' : pdfText(formatReportValue(value, index === 0 ? 'text' : column.kind, 'pdf'))}</Text>
          })}
        </View>
      )}
    </View>
  )
}

export function ReportDocument({ report }: { report: ReportDto }) {
  const landscape = report.tables.some(table => table.columns.length >= LANDSCAPE_FROM_COLUMNS)
  const generated = new Date(report.generatedAt).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
  })

  return (
    <Document title={`${report.title} — ${report.periodLabel}`} author={COMPANY_NAME}>
      <Page size="A4" orientation={landscape ? 'landscape' : 'portrait'} style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{COMPANY_NAME}</Text>
            <Text style={styles.title}>{pdfText(report.title)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>{pdfText(report.periodLabel)}</Text>
            <Text style={styles.muted}>{pdfText(report.branchName ?? 'All branches')}</Text>
            <Text style={styles.muted}>Generated {generated}</Text>
          </View>
        </View>

        <View style={styles.figures}>
          {report.figures.map(figure => (
            <View key={figure.label} style={styles.figure} wrap={false}>
              <Text style={styles.figureLabel}>{pdfText(figure.label)}</Text>
              <Text style={styles.figureValue}>{pdfText(formatReportValue(figure.value, figure.kind, 'pdf'))}</Text>
              {figure.note && <Text style={styles.figureNote}>{pdfText(figure.note)}</Text>}
            </View>
          ))}
        </View>

        {report.tables.map(table => <Table key={table.title} table={table} />)}

        {report.notes.length > 0 && (
          <View style={styles.notes} wrap={false}>
            {report.notes.map(note => <Text key={note}>{pdfText(note)}</Text>)}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{pdfText(`${report.title} · ${report.periodLabel}${report.branchName ? ` · ${report.branchName}` : ''}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
