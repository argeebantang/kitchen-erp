import Link from 'next/link'
import { getSession } from '@/lib/session'
import { ShoppingCart, Package, Clock, AlertTriangle, Sparkles } from 'lucide-react'
import { AssistantCard } from '@/components/ai/AssistantCard'
import { ASSISTANT_HISTORY, ASSISTANT_QUESTION_MAX, canUseAssistant } from '@/services/assistant.service'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { WasteReportCard } from '@/components/ai/WasteReportCard'
import { AiInsightService } from '@/services/ai-insight.service'
import { WASTE_REPORT_ROLES, WastePatternService } from '@/services/waste-pattern.service'
import { SupplierReportCard } from '@/components/ai/SupplierReportCard'
import { SUPPLIER_REPORT_ROLES, SupplierPerformanceService } from '@/services/supplier-performance.service'
import { DashboardService, type DashboardStatDto } from '@/services/dashboard.service'
import { KitchenAiOverview } from '@/components/ai/KitchenAiOverview'

/** The stat cards' look (Week 10 Task 7 filled in the figures; they were placeholders). */
const STAT_STYLE: Record<DashboardStatDto['key'], { icon: React.ElementType; accent: string }> = {
  requests: { icon: ShoppingCart,  accent: 'text-orange-600 bg-orange-50' },
  runs:     { icon: Package,       accent: 'text-blue-600 bg-blue-50' },
  expiry:   { icon: Clock,         accent: 'text-amber-600 bg-amber-50' },
  reorder:  { icon: AlertTriangle, accent: 'text-red-600 bg-red-50' },
}
const STAT_TONE: Record<DashboardStatDto['tone'], string> = {
  neutral: 'text-gray-800',
  alert:   'text-red-700',
  good:    'text-emerald-700',
}

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
  // Week 10 Task 7: the stat cards and one tile per KitchenAI feature the role may use.
  const overview = session ? await DashboardService.forViewer({ userId: session.userId, role: session.role }, { waste, suppliers }) : null

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

      {/* Stat cards: live counts, each linking to its page where the role can open it. */}
      {overview && overview.stats.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overview.stats.map(stat => {
            const { icon: Icon, accent } = STAT_STYLE[stat.key]
            const body = (
              <>
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
                  <Icon size={18} />
                </span>
                <p className={`mt-4 text-2xl font-bold ${STAT_TONE[stat.tone]}`}>{stat.value}</p>
                <p className="text-sm text-gray-600">{stat.label}</p>
                <p className="text-xs text-gray-400">{stat.note}</p>
              </>
            )
            return stat.href ? (
              <Link key={stat.key} href={stat.href} className="block rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">{body}</Link>
            ) : (
              <div key={stat.key} className="rounded-xl border border-gray-200 bg-white p-5">{body}</div>
            )
          })}
        </div>
      )}

      {/* Week 10: KitchenAI insights — a tile per feature, then the two reports in full. */}
      {session && overview && overview.kitchenAi.length > 0 && (
        <div className="mb-6 space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <Sparkles size={18} className="text-purple-600" aria-hidden="true" /> KitchenAI insights
          </h2>
          <KitchenAiOverview tiles={overview.kitchenAi} />
          {waste && (
            <div id="waste" className="scroll-mt-4">
              <WasteReportCard data={waste} canGenerate={AiInsightService.canGenerate('WASTE_PATTERN', session.role)} />
            </div>
          )}
          {suppliers && (
            <div id="suppliers" className="scroll-mt-4">
              <SupplierReportCard data={suppliers} canGenerate={AiInsightService.canGenerate('SUPPLIER_PERFORMANCE', session.role)} />
            </div>
          )}
          {(waste?.insight?.status === 'PENDING' || suppliers?.insight?.status === 'PENDING') && <AutoRefresh seconds={5} />}
        </div>
      )}
    </div>
  )
}
