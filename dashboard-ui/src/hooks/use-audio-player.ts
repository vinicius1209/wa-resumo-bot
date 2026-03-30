import { useRef, useState, useEffect, useCallback } from 'react'

export interface AudioPlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  isLoading: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (time: number) => void
}

export function useAudioPlayer(audioBase64: string | null, mimeType = 'audio/ogg'): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  // Create audio element once
  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => {
      setDuration(audio.duration)
      setIsLoading(false)
    }
    const onEnded = () => setIsPlaying(false)
    const onError = () => setIsLoading(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
      }
    }
  }, [])

  // Handle source changes
  useEffect(() => {
    if (!audioRef.current || !audioBase64) return

    // Pause and reset before changing source
    audioRef.current.pause()
    audioRef.current.removeAttribute('src')
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setIsLoading(true)

    // Revoke previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }

    // Convert base64 to blob URL
    try {
      const byteChars = atob(audioBase64)
      const byteArray = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i)
      }
      const blob = new Blob([byteArray], { type: mimeType })
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      audioRef.current.src = url
      audioRef.current.load()
    } catch {
      setIsLoading(false)
    }
  }, [audioBase64, mimeType])

  const play = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
  }, [])

  const pause = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    setIsPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    if (!audioRef.current) return
    if (audioRef.current.paused) play()
    else pause()
  }, [play, pause])

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = time
    setCurrentTime(time)
  }, [])

  return { isPlaying, currentTime, duration, isLoading, play, pause, toggle, seek }
}
