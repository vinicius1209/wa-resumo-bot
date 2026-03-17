import { Bot } from 'lucide-react'
import { parseWhatsAppMarkdown, formatTime } from '@/lib/utils'

export interface ChatMessageData {
  id: string
  role: 'user' | 'bot'
  content: string
  timestamp: Date
  loading?: boolean
}

interface ChatMessageProps {
  message: ChatMessageData
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
      <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isBot = message.role === 'bot'

  return (
    <div className={`flex gap-3 ${isBot ? 'justify-start' : 'justify-end'}`}>
      {isBot && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700">
          <Bot className="h-4 w-4 text-zinc-300" />
        </div>
      )}

      <div className={`max-w-[80%] space-y-1 ${isBot ? '' : 'flex flex-col items-end'}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isBot
              ? 'bg-zinc-800/50 text-zinc-100'
              : 'bg-blue-600/20 border border-blue-500/30 text-zinc-100'
          }`}
        >
          {message.loading ? (
            <TypingIndicator />
          ) : isBot ? (
            <div
              className="whitespace-pre-wrap break-words [&_strong]:font-semibold [&_em]:italic [&_s]:line-through [&_code]:text-emerald-400"
              dangerouslySetInnerHTML={{ __html: parseWhatsAppMarkdown(message.content) }}
            />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>
        <span className="block text-[11px] text-zinc-500 px-1">
          {formatTime(message.timestamp.getTime())}
        </span>
      </div>
    </div>
  )
}
