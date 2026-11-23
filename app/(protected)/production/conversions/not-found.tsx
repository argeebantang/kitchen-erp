import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/components/ui/states'

// Covers /production/conversions/[id], which calls notFound().
export default function ConversionOrderNotFound() {
  return (
    <EmptyState icon={FileQuestion} title="Conversion not found" action={{ href: '/production/conversions', label: 'Back to Conversions' }}>
      It may have been removed, or the link is wrong.
    </EmptyState>
  )
}
