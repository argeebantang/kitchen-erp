-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('REGULAR', 'SPECIAL_NON_WORKING', 'SPECIAL_WORKING', 'LOCAL');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'DEMAND_FORECAST';

-- AlterEnum
ALTER TYPE "AiInsightType" ADD VALUE 'DEMAND_FORECAST';

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- Pre-fill (hand-written, Week 10 Task 5): the 2026 Philippine regular and special non-working days of the
-- yearly proclamation. Eid'l Fitr and Eid'l Adha are proclaimed separately each year and are added by an admin
-- in Master Data → Holidays, like town fiestas and events. Ids are cuid-shaped ('c' + 24 hex). A date already
-- there is left alone.
INSERT INTO "Holiday" ("id", "date", "name", "type", "updatedAt")
SELECT 'c' || substr(md5('holiday-' || d), 1, 24), d::timestamp, n, t::"HolidayType", CURRENT_TIMESTAMP
FROM (VALUES
  ('2026-01-01', 'New Year''s Day',                         'REGULAR'),
  ('2026-02-17', 'Chinese New Year',                        'SPECIAL_NON_WORKING'),
  ('2026-04-02', 'Maundy Thursday',                         'REGULAR'),
  ('2026-04-03', 'Good Friday',                             'REGULAR'),
  ('2026-04-04', 'Black Saturday',                          'SPECIAL_NON_WORKING'),
  ('2026-04-09', 'Araw ng Kagitingan',                      'REGULAR'),
  ('2026-05-01', 'Labor Day',                               'REGULAR'),
  ('2026-06-12', 'Independence Day',                        'REGULAR'),
  ('2026-08-21', 'Ninoy Aquino Day',                        'SPECIAL_NON_WORKING'),
  ('2026-08-31', 'National Heroes Day',                     'REGULAR'),
  ('2026-11-01', 'All Saints'' Day',                        'SPECIAL_NON_WORKING'),
  ('2026-11-02', 'All Souls'' Day',                         'SPECIAL_NON_WORKING'),
  ('2026-11-30', 'Bonifacio Day',                           'REGULAR'),
  ('2026-12-08', 'Feast of the Immaculate Conception',      'SPECIAL_NON_WORKING'),
  ('2026-12-24', 'Christmas Eve',                           'SPECIAL_NON_WORKING'),
  ('2026-12-25', 'Christmas Day',                           'REGULAR'),
  ('2026-12-30', 'Rizal Day',                               'REGULAR'),
  ('2026-12-31', 'Last Day of the Year',                    'SPECIAL_NON_WORKING')
) AS h(d, n, t)
ON CONFLICT ("date") DO NOTHING;

-- The assistant's read-only login (Week 9) reads the calendar too.
GRANT SELECT ON "Holiday" TO kitchen_ai_reader;
