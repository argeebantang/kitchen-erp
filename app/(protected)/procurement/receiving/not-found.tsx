import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /procurement/receiving/[id] and /procurement/receiving/new with a
// missing or unknown ?po= — both call notFound().
export default function ReceivingReportNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Not found" action={{ href: '/procurement/receiving', label: 'Back to Receiving' }}>
      The receiving report or purchase order may have been removed, or the link is wrong.
    </EmptyState>
  )
}
