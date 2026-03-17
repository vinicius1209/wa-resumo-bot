import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { useChat } from '@/hooks/use-chat'
import { api } from '@/lib/api'
import type { BotCommand } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatInput } from '@/components/chat/ChatInput'

interface ChatPanelProps {
  groupId: string
  groups: { group_id: string; group_name: string | null }[]
}

export function ChatPanel({ groupId: initialGroupId, groups }: ChatPanelProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId)
  const [commands, setCommands] = useState<BotCommand[]>([])
  const { messages, loading, sendCommand, clearMessages, switchGroup } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedGroupId(initialGroupId)
  }, [initialGroupId])

  // Switch group history when selection changes
  useEffect(() => {
    if (selectedGroupId) {
      const group = groups.find((g) => g.group_id === selectedGroupId)
      switchGroup(selectedGroupId, group?.group_name ?? undefined)
    }
  }, [selectedGroupId, groups, switchGroup])

  useEffect(() => {
    api.commands().then(setCommands).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(
    (text: string) => {
      if (selectedGroupId) {
        sendCommand(selectedGroupId, text)
      }
    },
    [selectedGroupId, sendCommand]
  )

  const handleClear = useCallback(() => {
    clearMessages(selectedGroupId)
  }, [selectedGroupId, clearMessages])

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-500">Nenhum grupo encontrado</p>
      </div>
    )
  }

  const commandSuggestions = commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
  }))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <select
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-700"
        >
          {groups.map((g) => (
            <option key={g.group_id} value={g.group_id}>
              {g.group_name || g.group_id}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Limpar chat"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-zinc-800">
        <ChatInput
          onSend={handleSend}
          disabled={loading || !selectedGroupId}
          commands={commandSuggestions}
        />
      </div>
    </div>
  )
}
