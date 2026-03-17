import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { ConversationSessionSummary, ConversationSessionDetail } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, ChevronLeft, User, Bot } from 'lucide-react'

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  return `${Math.floor(diff / 86400)}d atrás`
}

export function ConversationsPage() {
  const [sessions, setSessions] = useState<ConversationSessionSummary[]>([])
  const [detail, setDetail] = useState<ConversationSessionDetail | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.conversations()
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar conversas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const openDetail = async (sessionId: string) => {
    try {
      const data = await api.conversationDetail(sessionId)
      setDetail(data)
      setShowContext(false)
    } catch {
      /* ignore */
    }
  }

  // Detail view
  if (detail) {
    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <Header
          title="Conversa"
          subtitle={`${detail.senderName} em ${detail.groupName}`}
        />
        <div className="p-6">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            onClick={() => setDetail(null)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Turns */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                    <MessageSquare className="h-4 w-4" />
                    {detail.turns.length} mensagens
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-4">
                      {detail.turns.map((turn, i) => (
                        <div
                          key={i}
                          className={`flex gap-3 ${turn.role === 'user' ? '' : ''}`}
                        >
                          <div
                            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                              turn.role === 'user'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                            }`}
                          >
                            {turn.role === 'user' ? (
                              <User className="h-3.5 w-3.5" />
                            ) : (
                              <Bot className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-zinc-400">
                                {turn.role === 'user' ? detail.senderName : 'Bot'}
                              </span>
                              <span className="text-xs text-zinc-600">
                                {formatTime(turn.timestamp)}
                              </span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">
                              {turn.content}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Info + Context */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-zinc-400">Detalhes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Grupo</span>
                    <span className="text-zinc-300">{detail.groupName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Usuário</span>
                    <span className="text-zinc-300">{detail.senderName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Início</span>
                    <span className="text-zinc-300">{formatDateTime(detail.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Última atividade</span>
                    <span className="text-zinc-300">{formatDateTime(detail.lastActivity)}</span>
                  </div>
                </CardContent>
              </Card>

              {detail.contextSnapshot && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-zinc-400">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between hover:text-zinc-300"
                        onClick={() => setShowContext(!showContext)}
                      >
                        Contexto injetado
                        <span className="text-xs text-zinc-600">{showContext ? '▲' : '▼'}</span>
                      </button>
                    </CardTitle>
                  </CardHeader>
                  {showContext && (
                    <CardContent>
                      <ScrollArea className="h-64">
                        <pre className="whitespace-pre-wrap text-xs text-zinc-500">
                          {detail.contextSnapshot}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title="Conversas"
        subtitle={`${sessions.length} sessão(ões) registrada(s)`}
      />
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="py-8 text-center text-sm text-zinc-600">Carregando...</p>
            ) : error ? (
              <div className="py-8 text-center">
                <p className="text-sm text-red-400">{error}</p>
                <p className="mt-1 text-xs text-zinc-600">
                  O modo conversacional pode estar desabilitado. Configure <code>CONVERSATION_ENABLED=true</code> no .env
                </p>
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-600">
                Nenhuma conversa registrada ainda. Mencione o bot em um grupo com texto livre para iniciar.
              </p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => openDetail(s.sessionId)}
                    className="flex w-full items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/30"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800">
                      <MessageSquare className="h-4 w-4 text-zinc-400" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200">{s.senderName}</span>
                        <span className="text-xs text-zinc-600">em</span>
                        <span className="truncate text-sm text-zinc-400">{s.groupName}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                        <span>{s.turnsCount} msgs</span>
                        <span>·</span>
                        <span>{timeAgo(s.lastActivity)}</span>
                      </div>
                    </div>
                    <Badge variant={s.status === 'active' ? 'success' : 'outline'}>
                      {s.status === 'active' ? 'Ativa' : 'Expirada'}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
