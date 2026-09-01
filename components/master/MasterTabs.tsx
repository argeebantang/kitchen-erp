import Link from 'next/link'

export const MASTER_TABS = [
  { key: 'materials',      label: 'Materials' },
  { key: 'finished-goods', label: 'Finished Goods' },
  { key: 'categories',     label: 'Categories' },
  { key: 'units',          label: 'Units' },
] as const

export type MasterTabKey = (typeof MASTER_TABS)[number]['key']

export function isMasterTab(value: string | undefined): value is MasterTabKey {
  return MASTER_TABS.some(tab => tab.key === value)
}

/**
 * Tabs are links, not client state — the active tab lives in the URL, so each
 * tab is a plain server render and the view is shareable/bookmarkable.
 */
export function MasterTabs({ active }: { active: MasterTabKey }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-gray-200">
      {MASTER_TABS.map(tab => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={`/admin/master?tab=${tab.key}`}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
