import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { BotStatus, DailyUsage, HourlyData, GroupSettings } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { StatusCards } from '@/components/dashboard/StatusCards'
import { HourlyChart } from '@/components/dashboard/HourlyChart'
import { GroupsTable } from '@/components/dashboard/GroupsTable'
import { LiveFeed } from '@/components/dashboard/LiveFeed'

export function OverviewPage() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [daily, setDaily] = useState<DailyUsage | null>(null)
  const [hourly, setHourly] = useState<HourlyData[]>([])
  const [groups, setGroups] = useState<GroupSettings[]>([])

  const fetchData = useCallback(async () => {
    const [statusRes, dailyRes, hourlyRes, groupsRes] = await Promise.allSettled([
      api.status(),
      api.dailyUsage(),
      api.hourlyUsage(),
      api.groups(),
    ])
    if (statusRes.status === 'fulfilled') setStatus(statusRes.value)
    if (dailyRes.status === 'fulfilled') setDaily(dailyRes.value)
    if (hourlyRes.status === 'fulfilled') setHourly(hourlyRes.value)
    if (groupsRes.status === 'fulfilled') setGroups(groupsRes.value)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Refresh status and daily usage every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const [statusRes, dailyRes] = await Promise.allSettled([
        api.status(),
        api.dailyUsage(),
      ])
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value)
      if (dailyRes.status === 'fulfilled') setDaily(dailyRes.value)
    }, 30_000)

    return () => clearInterval(interval)
  }, [])

  const handleToggle = useCallback(async (id: string, allow: boolean) => {
    try {
      if (allow) {
        await api.allowGroup(id)
      } else {
        await api.blockGroup(id)
      }
      const updated = await api.groups()
      setGroups(updated)
    } catch { /* ignore */ }
  }, [])

  const handleUpdateFeatures = useCallback(async (id: string, features: Record<string, boolean>) => {
    try {
      await api.updateFeatures(id, features)
      const updated = await api.groups()
      setGroups(updated)
    } catch { /* ignore */ }
  }, [])

  const handleSaveNotes = useCallback(async (id: string, notes: string) => {
    try {
      await api.updateGroup(id, { notes })
      const updated = await api.groups()
      setGroups(updated)
    } catch { /* ignore */ }
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="Overview" subtitle="Monitoramento em tempo real do bot" />
      <div className="space-y-6 p-6">
        <StatusCards status={status} daily={daily} />
        <HourlyChart data={hourly} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <GroupsTable
              groups={groups}
              onToggle={handleToggle}
              onUpdateFeatures={handleUpdateFeatures}
              onSaveNotes={handleSaveNotes}
            />
          </div>
          <div>
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
