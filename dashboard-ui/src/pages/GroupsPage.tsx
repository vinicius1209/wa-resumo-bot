import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { GroupSettings } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { GroupsTable } from '@/components/dashboard/GroupsTable'

export function GroupsPage() {
  const [groups, setGroups] = useState<GroupSettings[]>([])

  const fetchGroups = useCallback(async () => {
    try {
      const data = await api.groups()
      setGroups(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  const handleToggle = useCallback(async (id: string, allow: boolean) => {
    try {
      if (allow) {
        await api.allowGroup(id)
      } else {
        await api.blockGroup(id)
      }
      await fetchGroups()
    } catch { /* ignore */ }
  }, [fetchGroups])

  const handleUpdateFeatures = useCallback(async (id: string, features: Record<string, boolean>) => {
    try {
      await api.updateFeatures(id, features)
      await fetchGroups()
    } catch { /* ignore */ }
  }, [fetchGroups])

  const handleSaveNotes = useCallback(async (id: string, notes: string) => {
    try {
      await api.updateGroup(id, { notes })
      await fetchGroups()
    } catch { /* ignore */ }
  }, [fetchGroups])

  const pendingCount = groups.filter((g) => g.allowed === 0).length

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title="Grupos"
        subtitle={pendingCount > 0 ? `${pendingCount} grupo(s) aguardando ativação` : 'Gerenciamento de grupos'}
      />
      <div className="p-6">
        <GroupsTable
          groups={groups}
          onToggle={handleToggle}
          onUpdateFeatures={handleUpdateFeatures}
          onSaveNotes={handleSaveNotes}
        />
      </div>
    </div>
  )
}
