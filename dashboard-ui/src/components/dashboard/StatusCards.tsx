import type { BotStatus, DailyUsage } from '@/lib/api'
import { formatUptime, formatCost, formatTokens } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface StatusCardsProps {
  status: BotStatus | null
  daily: DailyUsage | null
}

export function StatusCards({ status, daily }: StatusCardsProps) {
  const isOnline = status?.online ?? false
  const tokensIn = daily?.totalTokens?.input ?? 0
  const tokensOut = daily?.totalTokens?.output ?? 0
  const totalTokens = tokensIn + tokensOut

  const breakdownText = daily?.commandBreakdown
    ? Object.entries(daily.commandBreakdown)
        .map(([cmd, count]) => `${cmd}: ${count}`)
        .join(', ')
    : '—'

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                isOnline ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-2xl font-bold">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {status ? `${formatUptime(status.uptime)} · ${status.groups} grupos` : '—'}
          </p>
        </CardContent>
      </Card>

      {/* Comandos hoje */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Comandos hoje</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{daily?.totalCommands ?? 0}</p>
          <p className="mt-1 truncate text-xs text-zinc-500">{breakdownText}</p>
        </CardContent>
      </Card>

      {/* Custo hoje */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Custo hoje</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCost(daily?.estimatedCost)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {daily ? `${daily.errors} erros · ${daily.mediaProcessed.total} mídia` : '—'}
          </p>
        </CardContent>
      </Card>

      {/* Tokens hoje */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Tokens hoje</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatTokens(totalTokens)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {daily
              ? `In: ${formatTokens(tokensIn)} · Out: ${formatTokens(tokensOut)}`
              : '—'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
