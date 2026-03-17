import { useCallback, useState } from 'react'
import { useWebSocket, type BotEvent } from '@/hooks/use-websocket'
import { formatTime } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface LiveFeedProps {
  maxItems?: number
}

const EVENT_CONFIG: Record<string, { icon: string; color: string }> = {
  message:   { icon: '💬', color: 'text-blue-400' },
  command:   { icon: '⚡', color: 'text-yellow-400' },
  media:     { icon: '🖼️', color: 'text-teal-400' },
  sentiment: { icon: '🌡️', color: 'text-orange-400' },
  error:     { icon: '❌', color: 'text-red-400' },
  llm_call:  { icon: '🧠', color: 'text-violet-400' },
}

function eventLabel(event: BotEvent): string {
  const d = event.data
  switch (event.type) {
    case 'message':
      return `${(d.pushName as string) || 'Desconhecido'} em ${(d.groupName as string) || (d.groupId as string) || '—'}`
    case 'command':
      return `/${(d.command as string) || '?'} em ${(d.groupName as string) || (d.groupId as string) || '—'}`
    case 'media':
      return `${(d.mediaType as string) || 'mídia'} processada`
    case 'sentiment':
      return `Sentimento: ${(d.sentiment as string) || '—'}`
    case 'error':
      return (d.message as string) || 'Erro desconhecido'
    case 'llm_call':
      return `${(d.model as string) || 'LLM'} · ${(d.tokens as number) ?? '?'} tokens`
    default:
      return event.type
  }
}

export function LiveFeed({ maxItems = 50 }: LiveFeedProps) {
  const [events, setEvents] = useState<BotEvent[]>([])

  const handleMessage = useCallback(
    (event: BotEvent) => {
      setEvents((prev) => {
        const next = [event, ...prev]
        return next.length > maxItems ? next.slice(0, maxItems) : next
      })
    },
    [maxItems]
  )

  const { connected } = useWebSocket(handleMessage)

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-zinc-400">Live Feed</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          {connected ? 'Conectado' : 'Desconectado'}
        </span>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div className="h-80 space-y-1 overflow-y-auto pr-1">
          {events.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-600">Aguardando eventos...</p>
          )}
          {events.map((event, idx) => {
            const cfg = EVENT_CONFIG[event.type] ?? { icon: '📌', color: 'text-zinc-400' }
            return (
              <div key={`${event.timestamp}-${idx}`} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 text-xs text-zinc-600">
                  {formatTime(event.timestamp)}
                </span>
                <span className="shrink-0">{cfg.icon}</span>
                <span className={`truncate ${cfg.color}`}>{eventLabel(event)}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
