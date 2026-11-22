import { getSession } from '@/lib/session'
import { ShoppingCart, Package, BarChart3, AlertTriangle, Sparkles } from 'lucide-react'
import { AssistantCard } from '@/components/ai/AssistantCard'
import { ASSISTANT_HISTORY, ASSISTANT_QUESTION_MAX, canUseAssistant } from '@/services/assistant.service'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { WasteReportCard } from '@/components/ai/WasteReportCard'
import { AiInsightService } from '@/services/ai-insight.service'
import { WASTE_REPORT_ROLES, WastePatternService } from '@/services/waste-pattern.service'
import { SupplierReportCard } from '@/components/ai/SupplierReportCard'
import { SUPPLIER_REPORT_ROLES, SupplierPerformanceService } from '@/services/supplier-performance.service'

type Stat = {
  label: string
  icon: React.ElementType
  accent: string
}

// Metric cards for the landing page. Values are intentionally empty ("—")
// until the underlying modules (procurement, production, inventory) exist —
// see docs/progress.md. Wire real counts in as each module lands.
const stats: Stat[] = [
  { label: 'Pending Requests',  icon: ShoppingCart,   accent: 'text-orange-600 bg-orange-50' },
  { label: 'Production Orders', icon: Package,        accent: 'text-blue-600 bg-blue-50' },
  { label: 'Stock Items',       icon: BarChart3,      accent: 'text-emerald-600 bg-emerald-50' },
  { label: 'Low Stock Alerts',  icon: AlertTriangle,  accent: 'text-red-600 bg-red-50' },
]

type PageProps = {
  // ?wasteBranch= narrows the Waste card to one branch (Week 10 Task 2 follow-up).
  searchParams: Promise<{ wasteBranch?: string; supplierMonth?: string; supplier?: string }>
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getSession()
  const { wasteBranch, supplierMonth, supplier } = await searchParams
  const roleLabel = session?.role.replace(/_/g, ' ').toLowerCase()
  // Week 10 Task 2: the KitchenAI insights the role may read (figures are free; only Generate / Regenerate cost).
  const waste = session && WASTE_REPORT_ROLES.includes(session.role) ? await WastePatternService.dashboard({ branchId: wasteBranch }) : null
  const suppliers = session && SUPPLIER_REPORT_ROLES.includes(session.role)
    ? await SupplierPerformanceService.dashboard({ month: supplierMonth, supplier })
    : null

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">
          Overview of kitchen operations
          {roleLabel && (
            <> · signed in as <span className="capitalize">{roleLabel}</span></>
          )}
        </p>
      </div>

      {/* Week 9 Task 3 (F4): the assistant, for the roles that see data across all branches. */}
      {session && (canUseAssistant(session.role) ? (
        <AssistantCard maxLength={ASSISTANT_QUESTION_MAX} history={ASSISTANT_HISTORY} />
      ) : (
        <p className="mb-6 flex items-center gap-1.5 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
          <Sparkles size={14} aria-hidden="true" /> The KitchenAI assistant is not available for your role yet.
        </p>
      ))}

      {/* Week 10: KitchenAI insights — Feature 3 first; F4–F6 join in later tasks. */}
      {session && (waste || suppliers) && (
        <div className="mb-6 space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <Sparkles size={18} className="text-purple-600" aria-hidden="true" /> KitchenAI insights
          </h2>
          {waste && <WasteReportCard data={waste} canGenerate={AiInsightService.canGenerate('WASTE_PATTERN', session.role)} />}
          {suppliers && <SupplierReportCard data={suppliers} canGenerate={AiInsightService.canGenerate('SUPPLIER_PERFORMANCE', session.role)} />}
          {(waste?.insight?.status === 'PENDING' || suppliers?.insight?.status === 'PENDING') && <AutoRefresh seconds={5} />}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => {
          const Icon = stat.icon
          return (
            <div
              key={stat.label}
              className="p-5 bg-white border border-gray-200 rounded-xl"
            >
              <div className="flex items-center justify-between">
                <span className={`flex items-center justify-center w-10 h-10 rounded-lg ${stat.accent}`}>
                  <Icon size={18} />
                </span>
              </div>
              <p className="mt-4 text-2xl font-bold text-gray-800">—</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          )
        })}
      </div>

      {/* Empty state note */}
      <div className="mt-6 p-8 text-center bg-white border border-dashed border-gray-200 rounded-xl">
        <p className="text-sm font-medium text-gray-600">No activity yet</p>
        <p className="mt-1 text-sm text-gray-400">
          Metrics will populate as procurement, production, and inventory data comes in.
        </p>
      </div>
    </div>
  )
}
