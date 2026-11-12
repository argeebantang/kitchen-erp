import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { WRITE_OFF_REASONS, WriteOffService } from '@/services/write-off.service'
import { WriteOffForm } from '@/components/inventory/WriteOffForm'

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
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">Choose a lot to write off</p>
          <p className="mt-1 text-sm text-gray-400">
            Open Finished Goods and click <span className="font-medium">Write off</span> on the lot. This lot has nothing on
            hand at that branch, or the link is incomplete.
          </p>
        </div>
      ) : (
        // A Client Component cannot import values from services/, so the reasons come in as props.
        <WriteOffForm lot={lot} reasons={WRITE_OFF_REASONS} />
      )}
    </div>
  )
}
