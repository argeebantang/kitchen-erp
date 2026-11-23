import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

export default function PurchaseOrderNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Purchase order not found" action={{ href: '/procurement/orders', label: 'Back to Purchase Orders' }}>
      It may have been removed, or the link is wrong.
    </EmptyState>
  )
}
