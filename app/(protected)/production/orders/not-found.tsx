import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /production/orders/[id] and its edit page — both call notFound().
export default function ProductionOrderNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Production order not found" action={{ href: '/production/orders', label: 'Back to Production orders' }}>
      It may have been removed, or the link is wrong.
    </EmptyState>
  )
}
