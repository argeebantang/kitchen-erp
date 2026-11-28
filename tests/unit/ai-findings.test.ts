import { describe, expect, it } from 'vitest'
import { findingsAbout, keepKnownFindings, parseFindings, type AiFinding, type AiFindingsReport } from '@/services/ai-findings'

/** Claude's findings are kept only when they parse and cite real figure rows. */

function finding(title: string, figureIds: string[]): AiFinding {
  return { figureIds, title, pattern: 'Keeps happening.', recommendation: 'Do this.', priority: 'medium' }
}

const report: AiFindingsReport = {
  summary: 'Waste is up.',
  findings: [
    finding('one', ['W1', 'X9']),
    finding('invented', ['X1', 'X2']),
    finding('two', ['W2']),
    finding('three', ['S1', 'W3']),
  ],
}

describe('parseFindings', () => {
  it('reads a well-formed report and trims its text', () => {
    const parsed = parseFindings(JSON.stringify({ summary: '  Waste is up. ', findings: [finding(' one ', ['W1'])] }))
    expect(parsed?.summary).toBe('Waste is up.')
    expect(parsed?.findings[0].title).toBe('one')
  })

  it('accepts a report with no findings', () => {
    expect(parseFindings(JSON.stringify({ summary: 'Nothing stands out.', findings: [] }))).toEqual({ summary: 'Nothing stands out.', findings: [] })
  })

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    ['not JSON', 'Here are my findings:'],
    ['JSON cut short', '{"summary":"Waste is up.","findings":[{"figureIds":["W1"]'],
    ['a blank summary', JSON.stringify({ summary: '   ', findings: [] })],
    ['an unknown priority', JSON.stringify({ summary: 'x', findings: [{ ...finding('one', ['W1']), priority: 'urgent' }] })],
    ['a missing recommendation', JSON.stringify({ summary: 'x', findings: [{ figureIds: ['W1'], title: 't', pattern: 'p', priority: 'low' }] })],
  ])('gives null for %s', (_label, content) => {
    expect(parseFindings(content)).toBeNull()
  })
})

describe('keepKnownFindings', () => {
  const known = new Set(['W1', 'W2', 'W3', 'S1'])

  it('drops ids that are not real rows, and findings left with none', () => {
    const kept = keepKnownFindings(report, known, 10)
    expect(kept.findings.map(f => [f.title, f.figureIds])).toEqual([
      ['one', ['W1']],
      ['two', ['W2']],
      ['three', ['S1', 'W3']],
    ])
    expect(kept.summary).toBe(report.summary)
  })

  it('caps the count after dropping, so an invented finding does not use up a place', () => {
    expect(keepKnownFindings(report, known, 2).findings.map(f => f.title)).toEqual(['one', 'two'])
  })
})

describe('findingsAbout', () => {
  it('keeps the findings citing any of the ids, with all their ids', () => {
    const about = findingsAbout(report, new Set(['S1']))
    expect(about.findings).toEqual([finding('three', ['S1', 'W3'])])
  })

  it('is empty when nothing cites the ids', () => {
    expect(findingsAbout(report, new Set(['Z1'])).findings).toEqual([])
  })
})
