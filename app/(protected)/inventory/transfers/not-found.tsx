import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

// Covers /inventory/transfers/[id], which calls notFound() — also for a
// branch manager opening another branch's transfer (T4).
export default function TransferNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <FileQuestion size={18} />
      </span>
      <p className="text-sm font-medium text-gray-600">Transfer not found</p>
      <p className="mt-1 text-sm text-gray-400">
        It may not exist, or it is not to or from your branch.
      </p>
      <Link
        href="/inventory/transfers"
        className="mt-4 inline-block rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
      >
        Back to Transfers
      </Link>
    </div>
  )
}
