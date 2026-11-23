import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /inventory/branches/[code], which calls notFound() — also for an
// inactive branch, and for a branch manager opening another branch (I4, I8).
export default function BranchInventoryNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Branch not found" action={{ href: '/inventory/branches', label: 'Back to Branch Inventory' }}>
      It may not exist or be inactive, or it is not the branch you manage.
    </EmptyState>
  )
}
