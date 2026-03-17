import { cn } from '@/lib/utils'

interface HeaderProps {
  title: string
  subtitle?: string
  className?: string
  children?: React.ReactNode
}

function Header({ title, subtitle, className, children }: HeaderProps) {
  return (
    <header
      className={cn(
        'flex items-center justify-between border-b border-zinc-800 px-6 py-4',
        className
      )}
    >
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </header>
  )
}

export { Header }
export type { HeaderProps }
