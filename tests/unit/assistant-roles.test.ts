import { afterEach, describe, expect, it, vi } from 'vitest'
import { canDraft } from '@/services/assistant-action.service'
import { canUseAssistant } from '@/services/assistant.service'
import { toolsFor } from '@/services/assistant-tools'

/**
 * Which KitchenAI tools each role gets. The tools are the assistant's only
 * reach into the data, so this list is its permission model.
 */

const toolNames = (role: string) => toolsFor(role).map(tool => tool.definition.name)

describe('who may use the assistant', () => {
  it('lets admin, accounting and production ask', () => {
    for (const role of ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER']) expect(canUseAssistant(role)).toBe(true)
  })

  it('keeps the other roles out', () => {
    for (const role of ['PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'VIEWER', 'admin', '']) expect(canUseAssistant(role)).toBe(false)
  })

  it('lets only admin and production draft documents', () => {
    expect(canDraft('ADMIN')).toBe(true)
    expect(canDraft('PRODUCTION_MANAGER')).toBe(true)
    expect(canDraft('ACCOUNTING')).toBe(false)
    expect(canDraft('VIEWER')).toBe(false)
  })
})

describe('toolsFor — without the AI reader database (AI_DATABASE_URL empty)', () => {
  it('gives admin the costs tool and both drafts, but no run_query', () => {
    expect(toolNames('ADMIN')).toEqual(['get_production_costs', 'draft_purchase_request', 'draft_production_order'])
  })

  it('gives production the same as admin', () => {
    expect(toolNames('PRODUCTION_MANAGER')).toEqual(toolNames('ADMIN'))
  })

  it('never gives accounting or viewers a draft tool', () => {
    expect(toolNames('ACCOUNTING')).toEqual(['get_production_costs'])
    expect(toolNames('VIEWER')).toEqual(['get_production_costs'])
  })

  it('gives nothing to roles outside the list', () => {
    expect(toolNames('PROCUREMENT_MANAGER')).toEqual([])
    expect(toolNames('BRANCH_MANAGER')).toEqual([])
    expect(toolNames('')).toEqual([])
  })
})

describe('toolsFor — with the AI reader database set up', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  // lib/config.ts reads the environment once, at import: load a fresh copy.
  async function freshToolNames(role: string) {
    vi.stubEnv('AI_DATABASE_URL', 'postgresql://reader:reader@localhost:5432/kitchen_erp_test')
    vi.resetModules()
    const { toolsFor: fresh } = await import('@/services/assistant-tools')
    return fresh(role).map(tool => tool.definition.name)
  }

  it('adds run_query for admin, accounting and production', async () => {
    expect(await freshToolNames('ADMIN')).toContain('run_query')
    expect(await freshToolNames('ACCOUNTING')).toEqual(['get_production_costs', 'run_query'])
    expect(await freshToolNames('PRODUCTION_MANAGER')).toContain('run_query')
  })

  it('still keeps run_query from viewers', async () => {
    expect(await freshToolNames('VIEWER')).toEqual(['get_production_costs'])
  })
})
