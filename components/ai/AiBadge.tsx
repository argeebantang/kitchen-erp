import { Sparkles } from 'lucide-react'

/**
 * The AI label every KitchenAI feature carries (Week 10 Task 2, roadmap: "All
 * AI features are clearly labeled with an AI badge"): what it marks was
 * written by Claude, not computed by the app. A Server Component; no state.
 */
export function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
      <Sparkles size={11} aria-hidden="true" />
      {label}
    </span>
  )
}
