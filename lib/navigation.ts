import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Truck,
  Package,
  BarChart3,
  GitBranch,
  Users,
  Settings,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  roles: string[]   // empty = visible to all roles
}

export type NavGroup = {
  group: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    group: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: [] },
    ],
  },
  {
    group: 'Procurement',
    items: [
      { label: 'Purchase Requests', href: '/procurement/requests',  icon: ShoppingCart,  roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
      { label: 'Purchase Orders',   href: '/procurement/orders',    icon: ClipboardList, roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
      { label: 'Receiving',         href: '/procurement/receiving', icon: Truck,         roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
    ],
  },
  {
    group: 'Production',
    items: [
      { label: 'Production Orders', href: '/production/orders', icon: Package,       roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
      { label: 'Bill of Materials', href: '/production/bom',    icon: ClipboardList, roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { label: 'Stock Levels', href: '/inventory/stock',     icon: BarChart3, roles: [] },
      { label: 'Transfers',    href: '/inventory/transfers', icon: GitBranch, roles: ['ADMIN', 'BRANCH_MANAGER'] },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Users',       href: '/admin/users',  icon: Users,    roles: ['ADMIN'] },
      { label: 'Master Data', href: '/admin/master', icon: Settings, roles: ['ADMIN'] },
    ],
  },
]
