import { z } from 'zod'

/**
 * The shape every KitchenAI report takes (Week 10 Task 3, shared by Feature 3
 * and Feature 6): a short summary and a few findings, each naming the figure
 * rows it rests on (W4, S2…), so the page can show those figures beside it.
 * Claude returns it as structured output (output_config.format); the code
 * still keeps only findings that name real rows, and at most `max` of them.
 */

export const PRIORITIES = ['high', 'medium', 'low'] as const

export type AiFinding = {
  figureIds: string[]
  title: string
  pattern: string
  recommendation: string
  priority: (typeof PRIORITIES)[number]
}

export type AiFindingsReport = { summary: string; findings: AiFinding[] }

/** The JSON schema Claude must answer in. The descriptions are the feature's own. */
export function findingsSchema(describe: { summary: string; findings: string; figureIds: string; title: string }): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings'],
    properties: {
      summary: { type: 'string', description: describe.summary },
      findings: {
        type: 'array',
        description: describe.findings,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['figureIds', 'title', 'pattern', 'recommendation', 'priority'],
          properties: {
            figureIds:      { type: 'array', items: { type: 'string' }, description: describe.figureIds },
            title:          { type: 'string', description: describe.title },
            pattern:        { type: 'string', description: 'What keeps happening, one or two sentences quoting the figures as given.' },
            recommendation: { type: 'string', description: 'One concrete action: who does what.' },
            priority:       { type: 'string', enum: [...PRIORITIES] },
          },
        },
      },
    },
  }
}

const ReportSchema = z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.object({
    figureIds:      z.array(z.string()),
    title:          z.string().trim().min(1),
    pattern:        z.string().trim().min(1),
    recommendation: z.string().trim().min(1),
    priority:       z.enum(PRIORITIES),
  })),
})

/** A report's JSON read back; null when it is not one (never written, cut short, not JSON). */
export function parseFindings(content: string | null): AiFindingsReport | null {
  if (!content) return null
  try {
    const parsed = ReportSchema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Only findings that name at least one real row (unknown ids dropped), at most `max`. */
export function keepKnownFindings(report: AiFindingsReport, ids: Set<string>, max: number): AiFindingsReport {
  return {
    summary: report.summary,
    findings: report.findings
      .map(finding => ({ ...finding, figureIds: finding.figureIds.filter(id => ids.has(id)) }))
      .filter(finding => finding.figureIds.length > 0)
      .slice(0, max),
  }
}

/** Only the findings that cite one of these rows — a page narrowed to one branch or supplier. */
export function findingsAbout(report: AiFindingsReport, ids: Set<string>): AiFindingsReport {
  return { ...report, findings: report.findings.filter(finding => finding.figureIds.some(id => ids.has(id))) }
}
