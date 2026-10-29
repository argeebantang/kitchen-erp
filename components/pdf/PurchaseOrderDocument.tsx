import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { PurchaseOrderDetailDto } from '@/services/purchase-order.service'
import { trimDecimal } from '@/lib/format'

/**
 * The purchase order as a PDF document.
 *
 * Built from @react-pdf/renderer primitives, NOT DOM elements: <View> and
 * <Text> here are not <div> and <p>, and Tailwind classes do nothing. Render it
 * only on the server (renderToBuffer in the route handler) — never import this
 * from a Client Component or from middleware.ts.
 *
 * Money is written "PHP 1,234.50", not "₱1,234.50": the built-in PDF fonts
 * cannot draw the peso sign, and bundling a font file just for one glyph is not
 * worth it. Display-only, like lib/format.ts — the strings already came out of
 * Decimal arithmetic in the service.
 */
const COMPANY_NAME = 'KitchenERP'

const COLOR_TEXT   = '#1f2937'
const COLOR_MUTED  = '#6b7280'
const COLOR_RULE   = '#d1d5db'
const COLOR_ACCENT = '#ea580c'

const styles = StyleSheet.create({
  page:   { padding: 40, paddingBottom: 56, fontSize: 10, color: COLOR_TEXT },

  header:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  company:      { fontSize: 14, fontWeight: 'bold', color: COLOR_ACCENT },
  docTitle:     { fontSize: 20, fontWeight: 'bold', marginTop: 2 },
  headerRight:  { alignItems: 'flex-end' },
  poNumber:     { fontSize: 14, fontWeight: 'bold' },
  muted:        { color: COLOR_MUTED },

  blocks:       { flexDirection: 'row', gap: 24, marginBottom: 24 },
  block:        { flex: 1 },
  blockLabel:   { fontSize: 8, color: COLOR_MUTED, textTransform: 'uppercase', marginBottom: 4 },
  blockLine:    { marginBottom: 2 },
  strong:       { fontWeight: 'bold' },

  tableHead:    { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLOR_TEXT, paddingBottom: 4, fontSize: 8, color: COLOR_MUTED, textTransform: 'uppercase' },
  row:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLOR_RULE, paddingVertical: 5 },
  colMaterial:  { width: '46%' },
  colQty:       { width: '18%', textAlign: 'right' },
  colUnit:      { width: '18%', textAlign: 'right' },
  colTotal:     { width: '18%', textAlign: 'right' },
  code:         { fontSize: 8, color: COLOR_MUTED },

  totalRow:     { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totalLabel:   { marginRight: 16 },
  totalValue:   { fontSize: 12, fontWeight: 'bold' },

  notes:        { marginTop: 24 },
  approval:     { marginTop: 24, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLOR_RULE },

  footer:       { position: 'absolute', left: 40, right: 40, bottom: 24, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: COLOR_MUTED },
})

function money(value: string): string {
  return `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function PurchaseOrderDocument({ po }: { po: PurchaseOrderDetailDto }) {
  // Decisions arrive newest first. An exportable order was approved, so there is
  // one; if it was somehow decided more than once, the latest approval wins.
  const approval = po.decisions.find(decision => decision.decision === 'APPROVED')

  return (
    <Document title={po.poNumber} author={COMPANY_NAME}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{COMPANY_NAME}</Text>
            <Text style={styles.docTitle}>Purchase Order</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.poNumber}>{po.poNumber}</Text>
            <Text style={styles.muted}>Date: {po.createdAt.slice(0, 10)}</Text>
            {po.prNumber && <Text style={styles.muted}>Request: {po.prNumber}</Text>}
          </View>
        </View>

        <View style={styles.blocks}>
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Supplier</Text>
            <Text style={[styles.blockLine, styles.strong]}>{po.supplierName ?? '—'}</Text>
            {po.supplierAddress && <Text style={styles.blockLine}>{po.supplierAddress}</Text>}
            {po.supplierEmail && <Text style={styles.blockLine}>{po.supplierEmail}</Text>}
            {po.supplierPhone && <Text style={styles.blockLine}>{po.supplierPhone}</Text>}
          </View>
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Delivery</Text>
            <Text style={styles.blockLine}>
              Expected: {po.expectedDelivery?.slice(0, 10) ?? 'not set'}
            </Text>
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={styles.colMaterial}>Material</Text>
          <Text style={styles.colQty}>Quantity</Text>
          <Text style={styles.colUnit}>Unit cost</Text>
          <Text style={styles.colTotal}>Line total</Text>
        </View>
        {po.lines.map(line => (
          // wrap={false}: a row is never split across two pages.
          <View key={line.id} style={styles.row} wrap={false}>
            <View style={styles.colMaterial}>
              <Text>{line.materialName}</Text>
              <Text style={styles.code}>{line.materialCode}</Text>
            </View>
            <Text style={styles.colQty}>
              {trimDecimal(line.quantity)} {line.unitAbbreviation}
            </Text>
            <Text style={styles.colUnit}>{money(line.unitCost)}</Text>
            <Text style={styles.colTotal}>{money(line.totalCost)}</Text>
          </View>
        ))}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.totalLabel}>Order total</Text>
          <Text style={styles.totalValue}>{money(po.totalAmount)}</Text>
        </View>

        {po.notes && (
          <View style={styles.notes}>
            <Text style={styles.blockLabel}>Notes</Text>
            <Text>{po.notes}</Text>
          </View>
        )}

        {approval && (
          <View style={styles.approval} wrap={false}>
            <Text>
              Approved by <Text style={styles.strong}>{approval.approverName}</Text> on{' '}
              {approval.decidedAt.slice(0, 10)}
            </Text>
            {approval.remarks && <Text style={styles.muted}>{approval.remarks}</Text>}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{po.poNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
