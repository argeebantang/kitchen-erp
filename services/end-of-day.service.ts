import { Prisma } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { addDays, businessDayRange, todayIsoDate } from '@/lib/dates'
import { FinishedGoodStockRepository, type DayFlow } from '@/repositories/finished-good-stock.repository'
import { ProductionOrderRepository } from '@/repositories/production-order.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { StockTransferRepository } from '@/repositories/stock-transfer.repository'
import { SOURCE_PAGES, type SourceDocumentDto } from '@/services/inventory.service'

/**
 * End of day (Week 7 Task 4): one business day of finished goods per branch
 * — opening, what was produced, converted in and out, written off and
 * distributed, and closing — read from the ledger alone, so it can never
 * disagree with the books (E1). A movement counts on the day it was written,
 * i.e. the day accounting approved it, not the day it was cooked (E2).
 * Nothing is stored.
 */

/**
 * A figure in the good's unit and its value at the lots' recorded cost per
 * unit (every lot since Week 6 Task 3 has one).
 */
export type EndOfDayFigureDto = { quantity: string; value: string }

export type EndOfDayRowDto = {
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  branchId: string
  branchName: string
  opening: EndOfDayFigureDto
  /** Signed, as on the ledger: in positive, out negative. */
  produced: EndOfDayFigureDto
  convertedIn: EndOfDayFigureDto
  convertedOut: EndOfDayFigureDto
  writtenOff: EndOfDayFigureDto
  /** Transfers to and from branches — from Week 8; zero until then. */
  distributed: EndOfDayFigureDto
  /** Movements that fit none of the flows above — zero unless something new writes the ledger. */
  other: EndOfDayFigureDto
  closing: EndOfDayFigureDto
  /** Movements this day. */
  movementCount: number
  /** opening + the named flows = closing — false when the ledger has a movement this page does not recognise (`other`). */
  balanced: boolean
  /** Today only: closing equals what the stock levels hold now; null on other days. */
  matchesStock: boolean | null
}

/**
 * One document behind the day's figures (E3): what it did to one finished good
 * at one branch — e.g. CNV-000001 took −10 kg Lechon from two lots, and put
 * +16 kg Lechon Paksiw in as a new one (two rows).
 */
export type EndOfDayDocumentDto = {
  /** The column it adds to; `other` is a movement the page does not recognise. */
  flow: DayFlow | 'other'
  source: SourceDocumentDto
  /** When the stock moved: the approval, ISO. */
  movedAt: string
  finishedGoodName: string
  finishedGoodCode: string
  unitAbbreviation: string
  branchName: string
  lotNumbers: string[]
  /** Signed, as on the ledger. */
  quantity: string
  /** At the lots' recorded cost; null only for a lot without one. */
  value: string | null
}

export type EndOfDayDto = {
  /** YYYY-MM-DD, Manila. */
  date: string
  previousDate: string
  /** Null when the day is today: there is no tomorrow to look at yet. */
  nextDate: string | null
  isToday: boolean
  rows: EndOfDayRowDto[]
  /** Pesos across every row, by figure. */
  totals: Record<'opening' | 'produced' | 'convertedIn' | 'convertedOut' | 'writtenOff' | 'distributed' | 'closing', string>
  movementCount: number
  documents: EndOfDayDocumentDto[]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A valid YYYY-MM-DD no later than today, else today. */
export function endOfDayDate(value: string | undefined): string {
  const today = todayIsoDate()
  if (!value || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return today
  return value > today ? today : value
}

const zero = new Prisma.Decimal(0)

function figure(quantity: Prisma.Decimal | null, value: Prisma.Decimal | null): EndOfDayFigureDto {
  // A flow with no movements is SUM over nothing (null): zero, and worth zero.
  return { quantity: toDecimalString(quantity ?? zero), value: toDecimalString(value ?? zero) }
}

export const EndOfDayService = {
  /**
   * `viewer` decides which documents link to their page — the same roles as
   * the Stock Ledger (SOURCE_PAGES); everyone else sees the number. Null (the
   * evening summary job, which has no viewer): no links.
   */
  async forDay(date: string, branchId: string | null, viewer: { role: string } | null): Promise<EndOfDayDto> {
    const today   = todayIsoDate()
    const isToday = date === today
    const { start, end } = businessDayRange(date)

    const [rows, levels, documentRows] = await Promise.all([
      FinishedGoodStockRepository.dayFlows(start, end, branchId),
      isToday ? FinishedGoodStockRepository.levelTotals(branchId) : Promise.resolve([]),
      FinishedGoodStockRepository.dayDocuments(start, end, branchId),
    ])
    const levelOf = new Map(levels.map(level => [`${level.finishedGoodId}:${level.branchId}`, level.quantity]))

    const sums = { opening: zero, produced: zero, convertedIn: zero, convertedOut: zero, writtenOff: zero, distributed: zero, closing: zero }
    const dtos = rows
      // A good with nothing on the books before or during the day, and nothing
      // left, has nothing to say about this day.
      .filter(row => Number(row.movementCount) > 0 || !(row.openingQty ?? zero).isZero() || !(row.closingQty ?? zero).isZero())
      .map<EndOfDayRowDto>(row => {
        // The named flows only: a movement that fits none of them lands in
        // `other` and breaks this, which is the point of the check.
        const flows = [row.producedQty, row.convertedInQty, row.convertedOutQty, row.writtenOffQty, row.distributedQty]
        const expected = flows.reduce<Prisma.Decimal>((sum, flow) => sum.add(flow ?? zero), row.openingQty ?? zero)
        const closing  = row.closingQty ?? zero
        sums.opening      = sums.opening.add(row.openingValue ?? zero)
        sums.produced     = sums.produced.add(row.producedValue ?? zero)
        sums.convertedIn  = sums.convertedIn.add(row.convertedInValue ?? zero)
        sums.convertedOut = sums.convertedOut.add(row.convertedOutValue ?? zero)
        sums.writtenOff   = sums.writtenOff.add(row.writtenOffValue ?? zero)
        sums.distributed  = sums.distributed.add(row.distributedValue ?? zero)
        sums.closing      = sums.closing.add(row.closingValue ?? zero)
        const level = levelOf.get(`${row.finishedGoodId}:${row.branchId}`) ?? zero
        return {
          finishedGoodId:   row.finishedGoodId,
          finishedGoodCode: row.finishedGoodCode,
          finishedGoodName: row.finishedGoodName,
          unitAbbreviation: row.unitAbbreviation,
          branchId:         row.branchId,
          branchName:       row.branchName,
          opening:          figure(row.openingQty, row.openingValue),
          produced:         figure(row.producedQty, row.producedValue),
          convertedIn:      figure(row.convertedInQty, row.convertedInValue),
          convertedOut:     figure(row.convertedOutQty, row.convertedOutValue),
          writtenOff:       figure(row.writtenOffQty, row.writtenOffValue),
          distributed:      figure(row.distributedQty, row.distributedValue),
          other:            figure(row.otherQty, row.otherValue),
          closing:          figure(row.closingQty, row.closingValue),
          movementCount:    Number(row.movementCount),
          balanced:         expected.equals(closing),
          matchesStock:     isToday ? level.equals(closing) : null,
        }
      })

    // Document numbers: one query per document type for the whole day.
    const idsOf = (type: string) => [...new Set(documentRows.filter(row => row.referenceType === type).map(row => row.referenceId))]
    const [productionNumbers, conversionNumbers, writeOffNumbers, transferNumbers] = await Promise.all([
      ProductionOrderRepository.numbersByIds(idsOf('ProductionOrder')),
      ConversionOrderRepository.numbersByIds(idsOf('ConversionOrder')),
      WriteOffRepository.numbersByIds(idsOf('WriteOff')),
      StockTransferRepository.numbersByIds(idsOf('StockTransfer')),
    ])
    const numbers = new Map<string, Map<string, string>>([
      ['ProductionOrder', productionNumbers],
      ['ConversionOrder', conversionNumbers],
      ['WriteOff',        writeOffNumbers],
      ['StockTransfer',   transferNumbers],
    ])
    const documents = documentRows.map<EndOfDayDocumentDto>(row => {
      const page = SOURCE_PAGES[row.referenceType]
      return {
        flow: row.flow,
        source: {
          type:   row.referenceType,
          id:     row.referenceId,
          number: numbers.get(row.referenceType)?.get(row.referenceId) ?? null,
          href:   page && viewer !== null && page.roles.includes(viewer.role) ? page.href(row.referenceId) : null,
        },
        movedAt:          row.movedAt.toISOString(),
        finishedGoodName: row.finishedGoodName,
        finishedGoodCode: row.finishedGoodCode,
        unitAbbreviation: row.unitAbbreviation,
        branchName:       row.branchName,
        lotNumbers:       row.lotNumbers,
        quantity:         toDecimalString(row.quantity),
        value:            row.value === null ? null : toDecimalString(row.value),
      }
    })

    return {
      date,
      previousDate: addDays(date, -1),
      nextDate:     isToday ? null : addDays(date, 1),
      isToday,
      rows:         dtos,
      totals: {
        opening:      toDecimalString(sums.opening),
        produced:     toDecimalString(sums.produced),
        convertedIn:  toDecimalString(sums.convertedIn),
        convertedOut: toDecimalString(sums.convertedOut),
        writtenOff:   toDecimalString(sums.writtenOff),
        distributed:  toDecimalString(sums.distributed),
        closing:      toDecimalString(sums.closing),
      },
      movementCount: dtos.reduce((count, row) => count + row.movementCount, 0),
      documents,
    }
  },
}
