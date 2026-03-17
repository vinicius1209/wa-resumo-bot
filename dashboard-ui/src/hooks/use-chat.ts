import { useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import type { ChatHistoryEntry } from '@/lib/api'

export interface ChatMessage {
  id: string
  role: 'user' | 'bot'
  content: string
  timestamp: Date
  loading?: boolean
}

function welcomeMessage(groupName?: string): ChatMessage {
  const name = groupName ? `*${groupName}*` : 'este grupo'
  return {
    id: `welcome-${Date.now()}`,
    role: 'bot',
    content: `Olá! Chat conectado a ${name}.\nDigite um /comando para começar.\n\nExemplos: \`/resumo 2h\`, \`/stats\`, \`/ajuda\``,
    timestamp: new Date(),
  }
}

function historyToMessages(entries: ChatHistoryEntry[]): ChatMessage[] {
  return entries.map((e) => ({
    id: `db-${e.id}`,
    role: e.role as 'user' | 'bot',
    content: e.content,
    timestamp: new Date(e.created_at * 1000),
  }))
}

export function useChat() {
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  // Cache em memória para não re-fetch ao voltar para um grupo já carregado na sessão
  const cacheRef = useRef<Map<string, ChatMessage[]>>(new Map())

  const switchGroup = useCallback((groupId: string, groupName?: string) => {
    setCurrentGroupId(groupId)

    // Se já temos cache da sessão atual, usa direto
    const cached = cacheRef.current.get(groupId)
    if (cached) {
      setMessages(cached)
      return
    }

    // Carrega do backend (persistido)
    const welcome = [welcomeMessage(groupName)]
    setMessages(welcome)

    api.chatHistory(groupId).then((entries) => {
      if (entries.length > 0) {
        const restored = [welcomeMessage(groupName), ...historyToMessages(entries)]
        cacheRef.current.set(groupId, restored)
        setMessages(restored)
      } else {
        cacheRef.current.set(groupId, welcome)
      }
    }).catch(() => {
      // Falha ao carregar histórico — mantém welcome
      cacheRef.current.set(groupId, welcome)
    })
  }, [])

  const sendCommand = useCallback(async (groupId: string, input: string) => {
    const trimmed = input.trim()
    if (!trimmed || !groupId) return

    let command: string
    let args: string
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ')
      command = parts[0]
      args = parts.slice(1).join(' ')
    } else {
      const parts = trimmed.split(' ')
      command = parts[0]
      args = parts.slice(1).join(' ')
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    }
    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'bot',
      content: '',
      timestamp: new Date(),
      loading: true,
    }

    setMessages((prev) => {
      const next = [...prev, userMsg, loadingMsg]
      cacheRef.current.set(groupId, next)
      return next
    })
    setLoading(true)

    try {
      const result = await api.executeCommand(groupId, command, args)

      const meaningful = result.replies.filter(
        (r) => !r.startsWith('⏳') && !r.startsWith('🔄')
      )
      const content = meaningful.length > 0 ? meaningful.join('\n\n') : result.replies.join('\n\n')

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'bot',
        content: content || 'Sem resposta.',
        timestamp: new Date(),
      }

      setMessages((prev) => {
        const next = prev.filter((m) => !m.loading).concat(botMsg)
        cacheRef.current.set(groupId, next)
        return next
      })
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'bot',
        content: `❌ ${err instanceof Error ? err.message : 'Erro ao executar comando'}`,
        timestamp: new Date(),
      }

      setMessages((prev) => {
        const next = prev.filter((m) => !m.loading).concat(errorMsg)
        cacheRef.current.set(groupId, next)
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const clearMessages = useCallback(async (groupId?: string) => {
    const id = groupId || currentGroupId
    if (!id) return
    const welcome: ChatMessage[] = [{
      id: `welcome-${Date.now()}`,
      role: 'bot',
      content: 'Chat limpo. Digite um /comando para começar.',
      timestamp: new Date(),
    }]
    cacheRef.current.set(id, welcome)
    setMessages(welcome)
    // Limpar do banco também (fire-and-forget)
    api.clearChatHistory(id).catch(() => {})
  }, [currentGroupId])

  return { messages, loading, sendCommand, clearMessages, switchGroup }
}
