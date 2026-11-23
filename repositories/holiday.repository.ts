import { HolidayType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Dates are stored as midnight UTC of the business date and given back as YYYY-MM-DD. */
const dateValue = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`)

export type HolidayRow = { id: string; date: string; name: string; type: HolidayType }

const select = { id: true, date: true, name: true, type: true } satisfies Prisma.HolidaySelect

function toRow(row: Prisma.HolidayGetPayload<{ select: typeof select }>): HolidayRow {
  return { id: row.id, date: row.date.toISOString().slice(0, 10), name: row.name, type: row.type }
}

/** The calendar of days that change demand (Week 10 Task 5). */
export const HolidayRepository = {
  /** Holidays from `from` to `to` (YYYY-MM-DD, both included), by date. */
  async between(from: string, to: string): Promise<HolidayRow[]> {
    const rows = await prisma.holiday.findMany({
      where:   { date: { gte: dateValue(from), lte: dateValue(to) } },
      select,
      orderBy: { date: 'asc' },
    })
    return rows.map(toRow)
  },

  /** Every year that has a holiday, newest first — the Holidays tab's year picker. */
  async years(): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT extract(year FROM date)::int AS year FROM "Holiday" ORDER BY year DESC`
    return rows.map(row => row.year)
  },

  /** Null when the date is taken (the unique key). */
  async create(input: { date: string; name: string; type: HolidayType }): Promise<HolidayRow | null> {
    try {
      return toRow(await prisma.holiday.create({ data: { ...input, date: dateValue(input.date) }, select }))
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null
      throw err
    }
  },

  /** 'TAKEN' when another holiday has the new date; null when the id is unknown. */
  async update(id: string, input: { date: string; name: string; type: HolidayType }): Promise<HolidayRow | 'TAKEN' | null> {
    try {
      return toRow(await prisma.holiday.update({ where: { id }, data: { ...input, date: dateValue(input.date) }, select }))
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'TAKEN'
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null
      throw err
    }
  },

  /** False when the id is unknown. */
  async remove(id: string): Promise<boolean> {
    const { count } = await prisma.holiday.deleteMany({ where: { id } })
    return count === 1
  },
}
