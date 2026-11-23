import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /inventory/transfers/[id], which calls notFound() — also for a
// branch manager opening another branch's transfer (T4).
export default function TransferNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Transfer not found" action={{ href: '/inventory/transfers', label: 'Back to Transfers' }}>
      It may not exist, or it is not to or from your branch.
    </EmptyState>
  )
}
