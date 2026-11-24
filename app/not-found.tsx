import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

/**
 * A URL that matches no page. Middleware sends a signed-out visitor to /login
 * first, so this is nearly always seen signed in — hence the link to the
 * dashboard. The protected layout does not apply to an unmatched URL, so the
 * card is centred on its own (Week 12 Task 1).
 */
export default function AppNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg">
        <EmptyState icon={FileQuestion} title="Page not found" action={{ href: '/dashboard', label: 'Go to Dashboard' }}>
          The link may be wrong, or the page has moved.
        </EmptyState>
      </div>
    </main>
  )
}
