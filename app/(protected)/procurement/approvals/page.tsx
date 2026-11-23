import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { APPROVAL_TYPE_LABELS, ApprovalInboxService, OVERDUE_HOURS } from '@/services/approval-inbox.service'
import { ApprovalInbox } from '@/components/procurement/ApprovalInbox'
import { AutoRefresh } from '@/components/ui/AutoRefresh'

/**
 * The unified approvals inbox (Week 11 Task 1): every purchase request,
 * purchase order, receiving report, production plan and completion,
 * conversion, write-off and transfer waiting for a decision, in one queue,
 * oldest first — decided in place. Replaces the eight per-type tables
 * (Weeks 3–8), from the same pending lists.
 */
export default async function ApprovalsInboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  // ?filter=overdue — where an overdue reminder leads (Week 11 Task 3). Anything else shows all.
  const { filter } = await searchParams
  const session = await getSession()
  if (!session) redirect('/login')

  const inbox = await ApprovalInboxService.list({ userId: session.userId, role: session.role })
  // Ages are measured from the render, so the server and the browser agree;
  // AutoRefresh re-renders every minute, which also picks up others' decisions.
  const now = Date.now()
  const overdue = inbox.items.filter(item => item.pendingSince !== null && now - Date.parse(item.pendingSince) >= OVERDUE_HOURS * 3_600_000).length

  return (
    <div>
      <AutoRefresh seconds={60} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Approvals</h1>
        <p className="mt-1 text-sm text-gray-400">
          {inbox.total === 0
            ? 'Nothing is waiting for approval.'
            : `${inbox.total} waiting for a decision${overdue > 0 ? `, ${overdue} for over ${OVERDUE_HOURS} hours` : ''}. Oldest first — approve in one click, or type a reason and reject. Open the number for the full document.`}
        </p>
      </div>

      <ApprovalInbox
        inbox={inbox}
        labels={APPROVAL_TYPE_LABELS}
        overdueHours={OVERDUE_HOURS}
        now={now}
        initialFilter={filter === 'overdue' && overdue > 0 ? 'OVERDUE' : 'ALL'}
      />
    </div>
  )
}
