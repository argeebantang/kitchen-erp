import Link from 'next/link'
import { ArrowLeft, PackageOpen } from 'lucide-react'
import { WRITE_OFF_REASONS, WriteOffService } from '@/services/write-off.service'
import { WriteOffForm } from '@/components/inventory/WriteOffForm'
import { EmptyState } from '@/components/ui/states'

type PageProps = {
  searchParams: Promise<{ lot?: string; branch?: string }>
}

/**
 * Opened from a lot on Finished Goods (?lot=&branch=): a write-off is always
 * of one lot at one branch (Week 7 Task 2, W2).
 */
export default async function NewWriteOffPage({ searchParams }: PageProps) {
  const { lot: lotId = '', branch: branchId = '' } = await searchParams
  const lot = lotId && branchId ? await WriteOffService.getForm(lotId, branchId) : null

  return (
    <div>
      <Link
        href="/inventory/finished-goods"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Finished Goods
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">Write Off</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Finished goods that cannot be used or converted — expired, spoiled, damaged. It goes to accounting, and leaves
        stock at the lot&apos;s cost when they approve it.
      </p>

      {lot === null ? (
        <EmptyState icon={PackageOpen} title="Choose a lot to write off" action={{ href: '/inventory/finished-goods', label: 'Open Finished Goods' }}>
          Click Write off on the lot in Finished Goods. This lot has nothing on hand at that branch, or the link is incomplete.
        </EmptyState>
      ) : (
        // A Client Component cannot import values from services/, so the reasons come in as props.
        <WriteOffForm lot={lot} reasons={WRITE_OFF_REASONS} />
      )}
    </div>
  )
}
