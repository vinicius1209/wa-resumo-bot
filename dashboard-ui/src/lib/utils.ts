import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  return parts.length ? parts.join(' ') : `${s % 60}s`
}

export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return '~'
  return `$${cost.toFixed(4)}`
}

export function formatTokens(n: number): string {
  return n > 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function formatTime(ts: number): string {
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function shortenGroupId(id: string): string {
  if (!id) return ''
  const cleaned = id.replace(/@g\.us$/, '')
  return cleaned.length > 20 ? cleaned.substring(0, 20) + '...' : cleaned
}

/** Parse WhatsApp-style markdown to HTML */
export function parseWhatsAppMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~(.+?)~/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code class="bg-zinc-800 px-1 rounded text-sm">$1</code>')
    .replace(/\n/g, '<br/>')
}
