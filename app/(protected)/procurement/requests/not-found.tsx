import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

/**
 * Rendered when PurchaseRequestDetailPage calls notFound().
 *
 * Placed at requests/ rather than the app root so it renders INSIDE the
 * protected layout — the user keeps the sidebar and topbar instead of landing
 * on a bare page.
 *
 * The wording covers both cases the service collapses into 404: the request
 * does not exist, or it belongs to someone else. Saying which would confirm to
 * a stranger that an id is real.
 */
export default function PurchaseRequestNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Purchase request not available" action={{ href: '/procurement/requests', label: 'Back to Purchase Requests' }}>
      It may not exist, or it may have been raised by someone else. You can only open requests you
      raised, unless you are in accounting, procurement or admin.
    </EmptyState>
  )
}
