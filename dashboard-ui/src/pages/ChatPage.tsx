import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { GroupSettings } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { ChatPanel } from '@/components/chat/ChatPanel'

export function ChatPage() {
  const [groups, setGroups] = useState<GroupSettings[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .groups()
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const defaultGroupId = groups[0]?.group_id ?? ''

  return (
    <div className="flex flex-1 flex-col">
      <Header title="Chat" subtitle="Execute comandos sem enviar ao WhatsApp" />
      <div className="flex flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-zinc-500">Carregando grupos...</p>
          </div>
        ) : (
          <ChatPanel
            groupId={defaultGroupId}
            groups={groups.map((g) => ({
              group_id: g.group_id,
              group_name: g.group_name,
            }))}
          />
        )}
      </div>
    </div>
  )
}
