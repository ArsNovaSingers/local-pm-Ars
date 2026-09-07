'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderKanban, Users, GanttChartSquare, Workflow, Flag } from 'lucide-react'

const navItems = [
  { href: '/board', label: 'Board', icon: LayoutDashboard },
  { href: '/timeline', label: 'Timeline', icon: GanttChartSquare },
  { href: '/network', label: 'Network', icon: Workflow },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/milestones', label: 'Milestones', icon: Flag },
  { href: '/people', label: 'Team Members', icon: Users },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-[220px] bg-background border-r border-border/40 flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5">
        <Link href="/board" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 bg-foreground rounded-md flex items-center justify-center">
            <span className="text-background font-bold text-sm">L</span>
          </div>
          <span className="text-[15px] font-semibold text-foreground tracking-tight">
            Local PM
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
