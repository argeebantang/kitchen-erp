import { HolidayType } from '@prisma/client'
import { z } from 'zod'
import { HOLIDAY_NAME_MAX } from '@/services/holiday.service'

/** A holiday as Master Data → Holidays sends it (Week 10 Task 5). */
export const HolidaySchema = z.object({
  date: z.string().date(),
  name: z.string().trim().min(1).max(HOLIDAY_NAME_MAX),
  type: z.nativeEnum(HolidayType),
})
