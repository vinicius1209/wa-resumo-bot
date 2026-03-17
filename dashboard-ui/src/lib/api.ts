const TOKEN_KEY = 'dashboard_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  }
  if (opts?.body) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, { ...opts, headers: { ...headers, ...opts?.headers } })
  if (res.status === 401 || res.status === 403) {
    clearToken()
    window.location.href = '/'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

// API types
export interface BotStatus {
  online: boolean
  uptime: number
  groups: number
  wsClients: number
}

export interface DailyUsage {
  totalCommands: number
  estimatedCost: number
  totalTokens: { input: number; output: number }
  errors: number
  mediaProcessed: { total: number; image: number; audio: number; video: number }
  commandBreakdown: Record<string, number>
  avgDurationMs: number
}

export interface GroupSettings {
  group_id: string
  group_name: string | null
  allowed: number
  features_json: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export interface BotCommand {
  name: string
  aliases: string[]
  description: string
}

export interface CommandResult {
  command: string
  replies: string[]
}

export interface ChatHistoryEntry {
  id: number
  group_id: string
  role: 'user' | 'bot'
  content: string
  command: string | null
  args: string | null
  created_at: number
}

export interface HourlyData {
  hour: number
  commands: number
  llm_calls: number
  media: number
}

export interface DailyCost {
  date: string
  cost: number
}

// API calls
export const api = {
  status: () => apiFetch<BotStatus>('/api/status'),
  dailyUsage: () => apiFetch<DailyUsage>('/api/analytics/daily'),
  weeklyUsage: () => apiFetch<Record<string, unknown>>('/api/analytics/weekly'),
  hourlyUsage: () => apiFetch<HourlyData[]>('/api/analytics/hourly'),
  dailyCosts: () => apiFetch<DailyCost[]>('/api/analytics/daily-costs'),
  groups: () => apiFetch<GroupSettings[]>('/api/groups'),
  groupSettings: (id: string) => apiFetch<GroupSettings>(`/api/groups/${encodeURIComponent(id)}`),
  updateGroup: (id: string, data: Record<string, unknown>) =>
    apiFetch(`/api/groups/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  allowGroup: (id: string) =>
    apiFetch(`/api/groups/${encodeURIComponent(id)}/allow`, { method: 'PUT' }),
  blockGroup: (id: string) =>
    apiFetch(`/api/groups/${encodeURIComponent(id)}/block`, { method: 'PUT' }),
  updateFeatures: (id: string, features: Record<string, boolean>) =>
    apiFetch(`/api/groups/${encodeURIComponent(id)}/features`, { method: 'PUT', body: JSON.stringify(features) }),
  commands: () => apiFetch<BotCommand[]>('/api/commands'),
  executeCommand: (groupId: string, command: string, args = '') =>
    apiFetch<CommandResult>(`/api/groups/${encodeURIComponent(groupId)}/command`, {
      method: 'POST',
      body: JSON.stringify({ command, args }),
    }),
  chatHistory: (groupId: string, limit = 100) =>
    apiFetch<ChatHistoryEntry[]>(`/api/groups/${encodeURIComponent(groupId)}/chat-history?limit=${limit}`),
  clearChatHistory: (groupId: string) =>
    apiFetch<{ ok: boolean; deleted: number }>(`/api/groups/${encodeURIComponent(groupId)}/chat-history`, { method: 'DELETE' }),
  config: () => apiFetch<Record<string, string>>('/api/config'),
  updateConfig: (data: Record<string, string>) =>
    apiFetch('/api/config', { method: 'PUT', body: JSON.stringify(data) }),
}
