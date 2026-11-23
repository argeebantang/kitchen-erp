import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { addDays } from '@/lib/dates'
import { inputClass, primaryButtonClass } from '@/components/ui/form'
import { DemandForecastService, FORECAST_GENERATE_ROLES } from '@/services/demand-forecast.service'
import { DemandPlan } from '@/components/production/DemandPlan'
import { DecisionSimulator } from '@/components/production/DecisionSimulator'
import {
  DecisionSimulatorService, SIMULATOR_EXPLAIN_ROLES, SIMULATOR_ORDER_ROLES,
} from '@/services/decision-simulator.service'
import { EmptyState } from '@/components/ui/states'
import { Factory } from 'lucide-react'

type PageProps = {
  searchParams: Promise<{ kitchen?: string; date?: string }>
}

/**
 * Production → Plan (Week 10 Task 5): what a kitchen should cook on a day —
 * Feature 5, the Demand Forecaster. One kitchen and one day, tomorrow by
 * default (requests close the afternoon before, owner 2026-11-21). Below it,
 * Feature 7, the Decision Simulator (Task 6): what if the kitchen cooks these
 * batches — starting from the plan's.
 */
export default async function ProductionPlanPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const [{ kitchen = '', date = '' }, options] = await Promise.all([searchParams, DemandForecastService.options()])
  const kitchenId = options.kitchens.some(option => option.id === kitchen) ? kitchen : options.kitchens[0]?.id
  const tomorrow = addDays(options.from, 1)
  const day = date >= options.from && date <= options.to ? date : tomorrow
  const [forecast, goods] = await Promise.all([
    kitchenId ? DemandForecastService.forecast(kitchenId, day) : null,
    DecisionSimulatorService.goods(),
  ])
  const canPlan = FORECAST_GENERATE_ROLES.includes(session.role)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Plan</h1>
        <p className="mt-1 text-sm text-gray-400">
          What to cook on a day: the outlets&apos; requests — or, while they are still open, what is usually asked on that
          weekday — less the stock still good and the runs already planned, allowing for the kitchen&apos;s yield.
        </p>
      </div>

      {/* A GET form, like Stock Levels': the view lives in the URL. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Kitchen</span>
          <select name="kitchen" defaultValue={kitchenId} className={inputClass}>
            {options.kitchens.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Day</span>
          <input type="date" name="date" defaultValue={day} min={options.from} max={options.to} className={inputClass} />
        </label>
        <button type="submit" className={primaryButtonClass}>Show</button>
      </form>

      {forecast ? (
        <div className="space-y-6">
          <DemandPlan forecast={forecast} canPlan={canPlan} canExplain={canPlan} />
          <div id="simulate">
            {/* Keyed by kitchen and day, so a new pick starts from that plan, not the last simulation. */}
            <DecisionSimulator
              key={forecast.position}
              kitchen={forecast.kitchen}
              date={forecast.date}
              goods={goods}
              initial={forecast.goods.filter(good => good.batches > 0).map(good => ({ finishedGoodId: good.finishedGoodId, batches: good.batches }))}
              canExplain={SIMULATOR_EXPLAIN_ROLES.includes(session.role)}
              canOrder={SIMULATOR_ORDER_ROLES.includes(session.role)}
            />
          </div>
        </div>
      ) : (
        <EmptyState icon={Factory} title="No active kitchen to plan for">
          An admin sets up kitchens in Master Data → Branches.
        </EmptyState>
      )}
    </div>
  )
}
