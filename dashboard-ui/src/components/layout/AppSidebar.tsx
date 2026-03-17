import { useLocation, Link } from 'react-router-dom'
import { LayoutDashboard, MessageSquare, Users, Settings, MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  connected: boolean
}

const navItems = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/conversations', label: 'Conversas', icon: MessagesSquare },
  { to: '/groups', label: 'Grupos', icon: Users },
  { to: '/settings', label: 'Config', icon: Settings },
] as const

function AppSidebar({ connected }: AppSidebarProps) {
  const location = useLocation()

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
        <span className="text-lg font-semibold text-zinc-100">WA-Resumo-Bot</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/')
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              connected ? 'bg-green-500' : 'bg-red-500'
            )}
          />
          {connected ? 'Conectado' : 'Desconectado'}
        </div>
      </div>
    </aside>
  )
}

export { AppSidebar }
export type { AppSidebarProps }
