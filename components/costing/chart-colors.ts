/**
 * One colour per costing figure, wherever it is drawn (Week 8 Task 6) — the
 * colour follows the figure, never its position. The first four categorical
 * slots of the dataviz reference palette, in that order, checked as a set for
 * colour-blind separation on a white surface. Aqua and yellow sit below 3:1
 * against white, which is why the figures are also in a table, never only in
 * a chart.
 */
export const CHART_COLORS = {
  batches:      '#2a78d6',
  conversion:   '#eb6834',
  writeOffs:    '#1baf7a',
  transferLoss: '#eda100',
} as const
