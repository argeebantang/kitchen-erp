import { EmailService, LATEST_EMAILS } from '@/services/email.service'
import { formatDateTime } from '@/lib/dates'
import { SendTestEmail } from '@/components/email/SendTestEmail'
import { NotificationEmailField } from '@/components/email/NotificationEmailField'

const STATUS_CLASSES = {
  SENT:    'bg-emerald-50 text-emerald-700',
  SKIPPED: 'bg-gray-100 text-gray-600',
  FAILED:  'bg-red-50 text-red-700',
} as const

const KIND_LABELS: Record<string, string> = {
  NOTIFICATION: 'Notification',
  TEST:         'Test',
  REPORT:       'Report',
  WEEKLY_SUMMARY: 'Weekly summary',
}

/**
 * Admin → Email (Week 11 Task 2): whether Resend is set up, who gets emails
 * and at which address, and every email sent, skipped or failed. ADMIN only —
 * the /admin guard in middleware.
 */
export default async function EmailSettingsPage() {
  const overview = await EmailService.overview()
  const withAddress = overview.users.filter(user => user.notificationEmail !== null).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Email</h1>
        <p className="mt-1 text-sm text-gray-400">
          Approval requests, decisions and the end-of-day summary are also emailed — to each person&apos;s notification address, never their login
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700">Connection</h2>
          <p className="mt-3 text-sm">
            {overview.configured
              ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Resend key set</span>
              : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not set up</span>}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {overview.configured
              ? <>The key is read from <code className="text-gray-700">RESEND_API_KEY</code> on the server and never shown.</>
              : <>Emails are skipped (logged below) until <code className="text-gray-700">RESEND_API_KEY</code> is added to <code className="text-gray-700">.env</code>. Restart <code className="text-gray-700">npm run dev</code> and <code className="text-gray-700">npm run worker</code> afterwards. The bell works either way.</>}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            From <span className="font-medium text-gray-700">{overview.from}</span>
            {overview.from.includes('onboarding@resend.dev') && ' — Resend\'s test sender: it delivers only to the Resend account\'s own address until you verify a domain and set EMAIL_FROM.'}
          </p>
          <SendTestEmail />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700">Last 7 days</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(['SENT', 'SKIPPED', 'FAILED'] as const).map(status => (
              <div key={status} className="rounded-lg border border-gray-100 p-3">
                <p className="text-2xl font-bold text-gray-800">{overview.lastSevenDays[status]}</p>
                <p className="text-xs text-gray-500">{status.toLowerCase()}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-gray-500">
            {withAddress} of {overview.users.length} users have a notification address. Someone without one gets the bell only — no email, and nothing logged.
          </p>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">Who gets emails</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Login</th>
                <th className="w-[28rem] px-4 py-3 font-medium">Notification email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overview.users.map(user => (
                <tr key={user.id}>
                  <td className="px-4 py-2 text-gray-800">{user.name}</td>
                  <td className="px-4 py-2 text-gray-500">{user.role.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-4 py-2 text-xs text-gray-400">{user.loginEmail}</td>
                  <td className="px-4 py-2">
                    <NotificationEmailField userId={user.id} name={user.name} initial={user.notificationEmail} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">Latest {LATEST_EMAILS} emails</h2>
        {overview.latest.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">No email yet. Submit something for approval, or send a test.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">To</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Why not sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overview.latest.map(row => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}>{row.status.toLowerCase()}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{KIND_LABELS[row.kind] ?? row.kind}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {row.userName ?? '—'} <span className="block text-xs text-gray-400">{row.toAddress ?? 'no address'}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{row.subject}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{row.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
