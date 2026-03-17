import { useState, useRef, useEffect, useCallback } from 'react'
import { SendHorizonal } from 'lucide-react'

interface Command {
  name: string
  description: string
}

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  commands?: Command[]
}

export function ChatInput({ onSend, disabled = false, commands = [] }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filteredCommands = value.startsWith('/')
    ? commands.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(value.slice(1).split(' ')[0].toLowerCase())
      )
    : []

  const shouldShowSuggestions =
    showSuggestions && value.startsWith('/') && !value.includes(' ') && filteredCommands.length > 0

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    setShowSuggestions(false)
  }, [value, disabled, onSend])

  const selectCommand = useCallback(
    (commandName: string) => {
      setValue(`/${commandName} `)
      setShowSuggestions(false)
      inputRef.current?.focus()
    },
    []
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (shouldShowSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && filteredCommands[selectedIndex])) {
        e.preventDefault()
        selectCommand(filteredCommands[selectedIndex].name)
        return
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setValue(newValue)
    setShowSuggestions(newValue.startsWith('/') && !newValue.includes(' '))
    setSelectedIndex(0)
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-4 pt-2">
      <div className="relative">
        {shouldShowSuggestions && (
          <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-zinc-800 bg-zinc-900 shadow-lg overflow-hidden z-10">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  idx === selectedIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectCommand(cmd.name)
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="font-mono text-blue-400">/{cmd.name}</span>
                <span className="text-zinc-500">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 focus-within:border-zinc-700 transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Digite um /comando..."
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
