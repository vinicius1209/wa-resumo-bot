import { Play, Pause, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useAudioPlayer } from '@/hooks/use-audio-player'

interface AudioPlayerProps {
  audioBase64: string
  durationSeconds?: number
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioPlayer({ audioBase64, durationSeconds }: AudioPlayerProps) {
  const { isPlaying, currentTime, duration, isLoading, toggle, seek } = useAudioPlayer(audioBase64)

  const totalDuration = duration || durationSeconds || 0

  return (
    <div className="flex items-center gap-3 rounded-xl bg-zinc-700/50 px-3 py-2.5 min-w-[240px] max-w-[320px]">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={isLoading}
        className="h-9 w-9 shrink-0 rounded-full bg-blue-600 hover:bg-blue-500 text-white hover:text-white disabled:opacity-50"
      >
        {isLoading ? (
          <Mic className="h-4 w-4 animate-pulse" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </Button>

      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <Slider
          value={[currentTime]}
          max={totalDuration || 1}
          step={0.1}
          onValueChange={([v]) => seek(v)}
          className="cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-zinc-400 tabular-nums px-0.5">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>
    </div>
  )
}
