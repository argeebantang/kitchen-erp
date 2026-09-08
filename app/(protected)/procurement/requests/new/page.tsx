import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MaterialService } from '@/services/material.service'
import { PurchaseRequestForm } from '@/components/procurement/PurchaseRequestForm'

export default async function NewPurchaseRequestPage() {
  // Server Component: calls the service directly instead of fetching its own
  // API route (docs/architecture.md). Every Decimal is already a string by the
  // time it lands here, which is what makes it safe to pass to a Client
  // Component as a prop.
  const { materials } = await MaterialService.list({ take: 200 })

  return (
    <div>
      <Link
        href="/procurement/requests"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Purchase Requests
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">New Purchase Request</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Pick materials and quantities. Costs are estimated from the current reference price.
      </p>

      <PurchaseRequestForm materials={materials} />
    </div>
  )
}