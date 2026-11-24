import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Truck,
  Package,
  CalendarDays,
  BarChart3,
  GitBranch,
  Users,
  Settings,
  Map,
  ClipboardCheck,
  ScrollText,
  CookingPot,
  Recycle,
  Trash2,
  Moon,
  Store,
  Coins,
  CalendarCheck,
  Sparkles,
  Mail,
  FileText,
  Receipt,
  PackageCheck
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  roles: string[]   // empty = visible to all roles
  /** Extra words the sidebar search matches — document prefixes and what people call the page. */
  keywords?: string[]
}

/** Cookie holding the sidebar's collapsed state, read by the protected layout so the first paint is right. */
export const SIDEBAR_COOKIE = 'sidebar'

export type NavGroup = {
  group: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    group: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: [] },
      // Week 11 Task 1: one queue for every document type, so it sits above the departments.
      { label: 'Approvals', href: '/procurement/approvals', icon: ClipboardCheck, roles: ['ADMIN', 'ACCOUNTING'], keywords: ['approve', 'inbox', 'pending'] },
      { label: 'Roadmap',   href: '/roadmap',   icon: Map,             roles: [] },
    ],
  },
  {
    group: 'Procurement',
    items: [
      { label: 'Purchase Requests', href: '/procurement/requests',  icon: ShoppingCart,  roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['PR', 'buy'] },
      { label: 'Purchase Orders', href: '/procurement/orders', icon: ClipboardList, roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'], keywords: ['PO', 'supplier'] },
      { label: 'Receiving',         href: '/procurement/receiving', icon: Truck,         roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'], keywords: ['RR', 'delivery', 'receiving report'] },
    ],
  },
  {
    group: 'Production',
    items: [
      { label: 'Production Orders', href: '/production/orders', icon: Package,       roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['PRD', 'batch', 'run', 'cook'] },
      { label: 'Production Schedule', href: '/production/schedule', icon: CalendarDays, roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['calendar'] },
      // Week 10 Task 5: what to cook on a day (Feature 5); Feature 7's simulator joins it in Task 6.
      { label: 'Plan',              href: '/production/plan',   icon: CalendarCheck, roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['forecast', 'simulator', 'what-if', 'demand'] },
      { label: 'Conversions',       href: '/production/conversions', icon: Recycle,  roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['CNV', 'convert'] },
      { label: 'Bill of Materials', href: '/production/bom',    icon: ClipboardList, roles: ['ADMIN', 'PRODUCTION_MANAGER'], keywords: ['BOM', 'recipe'] },
    ],
  },
  {
    group: 'Inventory',
    items: [
      // Week 8 Task 5: each branch's own page; a branch manager lands on theirs.
      { label: 'Branch Inventory', href: '/inventory/branches', icon: Store, roles: [] },
      { label: 'Stock Levels', href: '/inventory/stock',     icon: BarChart3, roles: [], keywords: ['stock map', 'reorder', 'low stock'] },
      { label: 'Finished Goods', href: '/inventory/finished-goods', icon: CookingPot, roles: [], keywords: ['lots', 'expiry'] },
      { label: 'Stock Ledger', href: '/inventory/ledger',    icon: ScrollText, roles: [], keywords: ['movements', 'history'] },
      { label: 'Write-offs',   href: '/inventory/write-offs', icon: Trash2,    roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'], keywords: ['WO', 'waste', 'spoiled'] },
      { label: 'End of Day',   href: '/inventory/end-of-day', icon: Moon,      roles: [] },
      { label: 'Receive',      href: '/inventory/receive', icon: PackageCheck, roles: ['ADMIN', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'], keywords: ['scan', 'QR', 'arriving', 'in transit', 'delivery', 'TRF', 'RTN'] },
      { label: 'Transfers',    href: '/inventory/transfers', icon: GitBranch, roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING', 'BRANCH_MANAGER'], keywords: ['TRF', 'delivery', 'return'] },
      { label: 'Stock Requests', href: '/inventory/requests', icon: ClipboardList, roles: ['ADMIN', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'], keywords: ['outlet order'] },
      { label: 'Daily Sales', href: '/inventory/sales', icon: Receipt, roles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'], keywords: ['SLS', 'sold'] },
    ],
  },
  {
    group: 'Costing',
    items: [
      // Week 8 Task 6: cost per week, per good, per batch, and what was lost.
      { label: 'Costing Dashboard', href: '/costing', icon: Coins, roles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER', 'VIEWER'], keywords: ['cost', 'variance'] },
    ],
  },
  {
    group: 'Reports',
    items: [
      // Week 11 Task 4: Excel / PDF reports from the same figures as the pages.
      { label: 'Reports', href: '/reports', icon: FileText, roles: ['ADMIN', 'ACCOUNTING', 'VIEWER', 'PRODUCTION_MANAGER', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER'], keywords: ['excel', 'pdf', 'summary'] },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Users',       href: '/admin/users',  icon: Users,    roles: ['ADMIN'] },
      { label: 'Master Data', href: '/admin/master', icon: Settings, roles: ['ADMIN'], keywords: ['materials', 'finished goods', 'suppliers', 'branches', 'holidays', 'units', 'categories'] },
      // Week 9 Task 1: the Claude connection, models and AI spend.
      { label: 'AI Settings', href: '/admin/ai',     icon: Sparkles, roles: ['ADMIN'], keywords: ['Claude', 'KitchenAI', 'questions'] },
      // Week 11 Task 2: Resend, who gets emails, and what went out.
      { label: 'Email',       href: '/admin/email',  icon: Mail,     roles: ['ADMIN'], keywords: ['Resend', 'notifications'] },
    ],
  },
]

/**
 * How well an item matches the search, lower is better; null = no match.
 * Enter opens the best one, so "pr" opens Purchase Requests (its keyword PR),
 * not Approvals (which merely contains "pr").
 */
export function matchScore(item: NavItem, group: string, query: string): number | null {
  const label = item.label.toLowerCase()
  const keywords = (item.keywords ?? []).map(keyword => keyword.toLowerCase())
  if (label === query || keywords.includes(query)) return 0
  if (label.startsWith(query)) return 1
  if (label.split(/[\s-]+/).some(word => word.startsWith(query))) return 2
  if (keywords.some(keyword => keyword.startsWith(query))) return 3
  if (group.toLowerCase().startsWith(query)) return 4
  if ([label, group.toLowerCase(), ...keywords].some(text => text.includes(query))) return 5
  return null
}
