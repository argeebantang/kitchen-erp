import type { ReportDto, ReportTableDto } from '@/services/report.service'
import { formatReportValue, isNumericKind } from '@/lib/report-format'

/**
 * A report on screen (Week 11 Task 4): headline figures, then each table,
 * then the notes — the same ReportDto as the Excel and the PDF. A Server
 * Component: nothing here is interactive.
 */
export function ReportView({ report }: { report: ReportDto }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {report.figures.map(figure => (
          <div key={figure.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{figure.label}</p>
            <p className="mt-1 text-xl font-bold text-gray-800">{formatReportValue(figure.value, figure.kind)}</p>
            {figure.note && <p className="mt-1 text-xs text-gray-400">{figure.note}</p>}
          </div>
        ))}
      </div>

      {report.tables.map(table => <ReportTable key={table.title} table={table} />)}

      {report.notes.length > 0 && (
        <div className="mt-6 space-y-1 text-xs text-gray-400">
          {report.notes.map(note => <p key={note}>{note}</p>)}
        </div>
      )}
    </div>
  )
}

function ReportTable({ table }: { table: ReportTableDto }) {
  const align = (index: number) => (isNumericKind(table.columns[index].kind) ? 'text-right' : 'text-left')
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">{table.title}</h2>
      {table.description && <p className="mt-0.5 text-xs text-gray-400">{table.description}</p>}
      {table.rows.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">{table.emptyText}</div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {table.columns.map((column, index) => (
                  <th key={column.key} className={`whitespace-nowrap px-3 py-2 font-medium ${align(index)}`}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.columns.map((column, index) => (
                    <td key={column.key} className={`whitespace-nowrap px-3 py-1.5 text-gray-700 ${align(index)}`}>
                      {formatReportValue(row[column.key] ?? null, column.kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {table.total && (
              <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-800">
                <tr>
                  {table.columns.map((column, index) => {
                    const value = table.total?.[column.key] ?? null
                    return (
                      <td key={column.key} className={`whitespace-nowrap px-3 py-2 ${align(index)}`}>
                        {value === null ? '' : formatReportValue(value, index === 0 ? 'text' : column.kind)}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  )
}
