import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

/**
 * Rendered when PurchaseRequestDetailPage calls notFound().
 *
 * Placed at requests/ rather than the app root so it renders INSIDE the
 * protected layout — the user keeps the sidebar and topbar instead of landing
 * on a bare page.
 *
 * The wording covers both cases the service collapses into 404: the request
 * does not exist, or it belongs to someone else. Saying which would confirm to
 * a stranger that an id is real.
 */
export default function PurchaseRequestNotFound() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <FileQuestion size={18} />
      </span>
      <p className="text-sm font-medium text-gray-600">Purchase request not available</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-400">
        It may not exist, or it may have been raised by someone else. You can only open requests
        you raised, unless you are in accounting, procurement or admin.
      </p>
      <Link
        href="/procurement/requests"
        className="mt-4 inline-block rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
      >
        Back to Purchase Requests
      </Link>
    </div>
  )
}