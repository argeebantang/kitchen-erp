import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  DecisionSimulatorService, SIMULATOR_EXPLAIN_ROLES, SIMULATOR_MAX_BATCHES, SIMULATOR_MAX_LINES,
} from '@/services/decision-simulator.service'

const SimulateSchema = z.object({
  kitchenId: z.string().cuid(),
  date:      z.string().date(),
  lines: z.array(z.object({
    finishedGoodId: z.string().cuid(),
    batches:        z.number().int().min(1).max(SIMULATOR_MAX_BATCHES),
  }).strict()).min(1).max(SIMULATOR_MAX_LINES),
  // Also ask Claude to explain it (Feature 7) — costs a call; the simulation alone is free.
  explain:   z.boolean().optional(),
}).strict()

/**
 * The Decision Simulator (Week 10 Task 6): runs a what-if production plan
 * against live recipes, stock and prices and returns the outcome. Writes
 * nothing. With `explain`, Claude's explanation comes back in the same
 * response (a few seconds) and is not stored — the AiCall row is the record.
 * Guard: ADMIN, PRODUCTION_MANAGER, ACCOUNTING (middleware).
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = SimulateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { explain, ...input } = parsed.data
    if (explain && !SIMULATOR_EXPLAIN_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Your role cannot ask for this AI explanation' }, { status: 403 })
    }

    const simulated = await DecisionSimulatorService.simulate(input)
    if (!simulated.success) return NextResponse.json({ error: simulated.error }, { status: simulated.status })
    if (!explain) return NextResponse.json({ simulation: simulated.data, explanation: null })

    const explained = await DecisionSimulatorService.explain(simulated.data, userId)
    // The simulation stands even when the AI is unavailable; the page shows why the explanation is missing.
    return NextResponse.json({
      simulation:  simulated.data,
      explanation: explained.success ? explained.data : null,
      explainError: explained.success ? null : explained.error,
    })
  } catch (err) {
    console.error('[POST /api/production/simulate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
