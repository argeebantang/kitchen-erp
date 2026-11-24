import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { StockTransferDetailDto, TransferMovementDto } from '@/services/stock-transfer.service'
import { formatDateTime } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { applyPdfDefaults } from '@/components/pdf/setup'

applyPdfDefaults(Font)

/**
 * The label stuck on a transfer's box or crate (Week 12): the number large
 * enough to read across a room, where it comes from and goes to, a QR code
 * that opens the transfer, and what is inside down to the lot — so the
 * receiver can count against it. A6, so it prints on a label printer or four
 * to an A4 sheet.
 *
 * react-pdf primitives, server-only — see PurchaseOrderDocument. The built-in
 * fonts have no "→" or "₱", hence the FROM / TO blocks and no money at all
 * (a label on a box is not the place for its value).
 */
const COMPANY_NAME = 'KitchenERP'

const COLOR_TEXT   = '#111827'
const COLOR_MUTED  = '#6b7280'
const COLOR_RULE   = '#d1d5db'
const COLOR_ACCENT = '#ea580c'

const styles = StyleSheet.create({
  page:       { padding: 18, paddingBottom: 30, fontSize: 9, color: COLOR_TEXT },

  top:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  company:    { fontSize: 9, fontWeight: 'bold', color: COLOR_ACCENT },
  kind:       { fontSize: 8, fontWeight: 'bold', letterSpacing: 1, color: COLOR_MUTED },
  number:     { fontSize: 24, fontWeight: 'bold', marginTop: 2, marginBottom: 8 },

  route:      { flexDirection: 'row', gap: 10, marginBottom: 8 },
  end:        { flex: 1, borderWidth: 1, borderColor: COLOR_TEXT, borderRadius: 4, padding: 5 },
  endLabel:   { fontSize: 7, color: COLOR_MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  endName:    { fontSize: 11, fontWeight: 'bold', marginTop: 1 },

  qrRow:      { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 },
  qr:         { width: 118, height: 118 },
  qrText:     { flex: 1 },
  qrLine:     { marginBottom: 3, color: COLOR_MUTED },
  strong:     { fontWeight: 'bold', color: COLOR_TEXT },

  goodsHead:  { fontSize: 7, color: COLOR_MUTED, textTransform: 'uppercase', letterSpacing: 1, borderBottomWidth: 1, borderBottomColor: COLOR_TEXT, paddingBottom: 2, marginBottom: 2 },
  good:       { borderBottomWidth: 0.5, borderBottomColor: COLOR_RULE, paddingVertical: 3 },
  goodRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  goodName:   { fontWeight: 'bold', flex: 1 },
  lot:        { fontSize: 7.5, color: COLOR_MUTED, marginTop: 1 },

  notes:      { marginTop: 6, fontSize: 8, color: COLOR_MUTED },
  footer:     { position: 'absolute', left: 18, right: 18, bottom: 12, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: COLOR_MUTED },
})

export function TransferLabelDocument({ transfer, qrDataUrl }: { transfer: StockTransferDetailDto; qrDataUrl: string }) {
  const lots = transfer.stockMoved.out
  // Every lot leaves in the approval's transaction, so they share one time.
  const dispatchedAt = lots[0]?.at ?? null
  const lotsByGood = new Map<string, TransferMovementDto[]>()
  for (const lot of lots) lotsByGood.set(lot.finishedGoodName, [...(lotsByGood.get(lot.finishedGoodName) ?? []), lot])

  return (
    <Document title={`${transfer.transferNumber} label`} author={COMPANY_NAME}>
      <Page size="A6" style={styles.page}>
        <View style={styles.top}>
          <Text style={styles.company}>{COMPANY_NAME}</Text>
          <Text style={styles.kind}>{transfer.kind === 'RETURN' ? 'RETURN' : 'DELIVERY'}</Text>
        </View>
        <Text style={styles.number}>{transfer.transferNumber}</Text>

        <View style={styles.route}>
          <View style={styles.end}>
            <Text style={styles.endLabel}>From</Text>
            <Text style={styles.endName}>{transfer.fromBranch.name}</Text>
          </View>
          <View style={styles.end}>
            <Text style={styles.endLabel}>To</Text>
            <Text style={styles.endName}>{transfer.toBranch.name}</Text>
          </View>
        </View>

        <View style={styles.qrRow}>
          {/* react-pdf's Image has no alt prop — it is a PDF, not HTML. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={qrDataUrl} style={styles.qr} />
          <View style={styles.qrText}>
            <Text style={styles.qrLine}><Text style={styles.strong}>Receiving?</Text> Scan this in KitchenERP (Receive), or with a phone camera.</Text>
            <Text style={styles.qrLine}>No signal or scanner: open Receive and type <Text style={styles.strong}>{transfer.transferNumber}</Text>.</Text>
            {dispatchedAt && <Text style={styles.qrLine}>Left {formatDateTime(dispatchedAt)}</Text>}
          </View>
        </View>

        <Text style={styles.goodsHead}>Inside</Text>
        {transfer.lines.map(line => (
          <View key={line.finishedGoodId} style={styles.good} wrap={false}>
            <View style={styles.goodRow}>
              <Text style={styles.goodName}>{line.finishedGoodName}</Text>
              <Text>{trimDecimal(line.quantity)} {line.unitAbbreviation}</Text>
            </View>
            {(lotsByGood.get(line.finishedGoodName) ?? []).map(lot => (
              <Text key={lot.lotId} style={styles.lot}>
                Lot {lot.lotNumber} · {trimDecimal(lot.quantity)} {lot.unitAbbreviation}
                {lot.expiresAt ? ` · use by ${formatDateTime(lot.expiresAt)}` : ''}
              </Text>
            ))}
          </View>
        ))}

        {transfer.notes && <Text style={styles.notes}>Note: {transfer.notes}</Text>}

        <View style={styles.footer} fixed>
          <Text>Count what arrived before confirming.</Text>
          <Text render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${transfer.transferNumber} · ${pageNumber}/${totalPages}` : '')} />
        </View>
      </Page>
    </Document>
  )
}
