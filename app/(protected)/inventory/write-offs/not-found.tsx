import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /inventory/write-offs/[id], which calls notFound().
export default function WriteOffNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Write-off not found" action={{ href: '/inventory/write-offs', label: 'Back to Write-offs' }}>
      It may have been removed, or the link is wrong.
    </EmptyState>
  )
}
