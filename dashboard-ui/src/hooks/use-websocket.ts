import { useEffect, useRef, useState, useCallback } from 'react'
import { getToken } from '@/lib/api'

export interface BotEvent {
  type: string
  data: Record<string, unknown>
  timestamp: number
}

export function useWebSocket(onMessage?: (event: BotEvent) => void) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const callbackRef = useRef(onMessage)
  callbackRef.current = onMessage

  const connect = useCallback(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws?token=${encodeURIComponent(getToken())}`
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 5000)
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BotEvent
        callbackRef.current?.(data)
      } catch { /* ignore */ }
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()
    return () => { wsRef.current?.close() }
  }, [connect])

  return { connected }
}
