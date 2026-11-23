import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

/**
 * notFound() from a protected page whose module has no not-found.tsx of its
 * own (a stock request, a sale, a BOM, an unknown report). Inside the layout,
 * so the sidebar stays. The wording never says whether the record exists —
 * that would confirm an id to someone not allowed to open it (Week 12 Task 1).
 */
export default function ProtectedNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Not available" action={{ href: '/dashboard', label: 'Go to Dashboard' }}>
      It may have been removed, the link may be wrong, or it is not one your role can open.
    </EmptyState>
  )
}
