import { useState, useCallback } from 'react'
import type { TriageProject, TriageItemEntry } from '@/lib/api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'

// ─── Priority badge ──────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    p0: 'border-red-500/50 bg-red-500/20 text-red-400',
    p1: 'border-orange-500/50 bg-orange-500/20 text-orange-400',
    p2: 'border-yellow-500/50 bg-yellow-500/20 text-yellow-400',
    p3: 'border-zinc-700 bg-zinc-800/50 text-zinc-400',
  }
  const cls = map[priority.toLowerCase()] ?? map['p3']
  return (
    <span className={cn('rounded border px-2 py-0.5 text-xs font-medium', cls)}>
      {priority.toUpperCase()}
    </span>
  )
}

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    bug: 'border-red-500/50 bg-red-500/20 text-red-400',
    feature: 'border-blue-500/50 bg-blue-500/20 text-blue-400',
    question: 'border-purple-500/50 bg-purple-500/20 text-purple-400',
    support: 'border-green-500/50 bg-green-500/20 text-green-400',
    update: 'border-zinc-700 bg-zinc-800/50 text-zinc-400',
  }
  const cls = map[type.toLowerCase()] ?? map['update']
  return (
    <span className={cn('rounded border px-2 py-0.5 text-xs font-medium', cls)}>
      {type}
    </span>
  )
}

// ─── Board config editor ──────────────────────────────────────────────────────

interface Board {
  adapter: string
  config: Record<string, string>
}

interface BoardEditorProps {
  boards: Board[]
  onChange: (boards: Board[]) => void
}

function BoardEditor({ boards, onChange }: BoardEditorProps) {
  function updateBoard(index: number, updated: Board) {
    const next = boards.map((b, i) => (i === index ? updated : b))
    onChange(next)
  }

  function removeBoard(index: number) {
    onChange(boards.filter((_, i) => i !== index))
  }

  function addBoard() {
    onChange([...boards, { adapter: 'notion', config: { databaseId: '' } }])
  }

  function updateConfigKey(boardIndex: number, oldKey: string, newKey: string) {
    const board = boards[boardIndex]
    const entries = Object.entries(board.config)
    const updated: Record<string, string> = {}
    for (const [k, v] of entries) {
      updated[k === oldKey ? newKey : k] = v
    }
    updateBoard(boardIndex, { ...board, config: updated })
  }

  function updateConfigValue(boardIndex: number, key: string, value: string) {
    const board = boards[boardIndex]
    updateBoard(boardIndex, { ...board, config: { ...board.config, [key]: value } })
  }

  function addConfigField(boardIndex: number) {
    const board = boards[boardIndex]
    const newKey = `campo${Object.keys(board.config).length + 1}`
    updateBoard(boardIndex, { ...board, config: { ...board.config, [newKey]: '' } })
  }

  function removeConfigField(boardIndex: number, key: string) {
    const board = boards[boardIndex]
    const next = { ...board.config }
    delete next[key]
    updateBoard(boardIndex, { ...board, config: next })
  }

  return (
    <div className="space-y-3">
      {boards.map((board, bi) => (
        <div key={bi} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Adapter</label>
              <select
                value={board.adapter}
                onChange={(e) => updateBoard(bi, { ...board, adapter: e.target.value })}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-zinc-600 focus:outline-none"
              >
                <option value="notion">notion</option>
                <option value="linear">linear</option>
                <option value="github">github</option>
                <option value="jira">jira</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => removeBoard(bi)}
              className="text-zinc-600 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {Object.entries(board.config).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1.5">
                <Input
                  value={key}
                  onChange={(e) => updateConfigKey(bi, key, e.target.value)}
                  placeholder="chave"
                  className="h-7 flex-1 bg-zinc-900 text-xs"
                />
                <span className="text-zinc-600">:</span>
                <Input
                  value={value}
                  onChange={(e) => updateConfigValue(bi, key, e.target.value)}
                  placeholder="valor"
                  className="h-7 flex-[2] bg-zinc-900 text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeConfigField(bi, key)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addConfigField(bi)}
            className="mt-2 flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Campo
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addBoard}
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar board
      </button>
    </div>
  )
}

// ─── Contact list editor ──────────────────────────────────────────────────────

interface ContactEditorProps {
  contacts: string[]
  onChange: (contacts: string[]) => void
}

function ContactEditor({ contacts, onChange }: ContactEditorProps) {
  const [draft, setDraft] = useState('')

  function addContact() {
    const jid = draft.trim()
    if (!jid || contacts.includes(jid)) return
    onChange([...contacts, jid])
    setDraft('')
  }

  function removeContact(jid: string) {
    onChange(contacts.filter((c) => c !== jid))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {contacts.map((jid) => (
          <span
            key={jid}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
          >
            {jid}
            <button
              type="button"
              onClick={() => removeContact(jid)}
              className="text-zinc-600 hover:text-red-400 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {contacts.length === 0 && (
          <span className="text-xs text-zinc-600">Nenhum contato</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addContact())}
          placeholder="5547900000000@s.whatsapp.net"
          className="h-7 flex-1 bg-zinc-900 text-xs"
        />
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={addContact}>
          <Plus className="h-3 w-3" />
          Adicionar
        </Button>
      </div>
    </div>
  )
}

// ─── Recent items mini-table ──────────────────────────────────────────────────

function RecentItems({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<TriageItemEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (items !== null) return
    setLoading(true)
    try {
      const data = await api.triageItems(projectId, 10)
      setItems(data)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [projectId, items])

  function toggle() {
    setOpen((prev) => !prev)
    if (!open) load()
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Ultimos itens triados
      </button>

      {open && (
        <div className="rounded-md border border-zinc-800 overflow-hidden">
          {loading && (
            <div className="px-4 py-3 text-xs text-zinc-600">Carregando...</div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="px-4 py-3 text-xs text-zinc-600">Nenhum item ainda</div>
          )}
          {!loading && items && items.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Titulo</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Prioridade</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-500">Board</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                    <td className="max-w-[240px] truncate px-3 py-2 text-zinc-300">
                      {item.board_item_url ? (
                        <a
                          href={item.board_item_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-blue-400 hover:underline"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <TypeBadge type={item.type} />
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge priority={item.priority} />
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{item.board_adapter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── New project form (inline dialog) ────────────────────────────────────────

interface NewProjectFormProps {
  onCreated: () => void
  onCancel: () => void
}

function NewProjectForm({ onCreated, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState('')
  const [contacts, setContacts] = useState<string[]>([])
  const [boards, setBoards] = useState<Board[]>([{ adapter: 'notion', config: { databaseId: '' } }])
  const [repoUrl, setRepoUrl] = useState('')
  const [context, setContext] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Nome e obrigatorio'); return }
    if (contacts.length === 0) { setError('Adicione pelo menos um contato'); return }
    if (boards.length === 0) { setError('Adicione pelo menos um board'); return }

    setSaving(true)
    try {
      await api.createTriageProject({
        name: name.trim(),
        contacts,
        boards,
        repoUrl: repoUrl.trim() || undefined,
        context: context.trim() || undefined,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar projeto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-200">Novo projeto</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Nome *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do projeto"
            className="bg-zinc-950"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Contatos *</label>
          <ContactEditor contacts={contacts} onChange={setContacts} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Boards *</label>
          <BoardEditor boards={boards} onChange={setBoards} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Repo URL (opcional)</label>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="bg-zinc-950"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Contexto para o classificador (opcional)</label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="Descricao do projeto para o LLM classificador..."
            className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Salvando...' : 'Criar projeto'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─── Project row ──────────────────────────────────────────────────────────────

interface ProjectRowProps {
  project: TriageProject
  onUpdated: () => void
  onDeleted: () => void
}

function ProjectRow({ project, onUpdated, onDeleted }: ProjectRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState(project.name)
  const [contacts, setContacts] = useState<string[]>(project.contacts)
  const [boards, setBoards] = useState<Board[]>(project.boards)
  const [repoUrl, setRepoUrl] = useState(project.repoUrl ?? '')
  const [context, setContext] = useState(project.context ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // Sync if parent data changes (after refresh)
  // (shallow – if user already edited, we keep their local draft)

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      await api.updateTriageProject(project.id, {
        name: name.trim() || project.name,
        contacts,
        boards,
        repoUrl: repoUrl.trim() || undefined,
        context: context.trim() || undefined,
      })
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir projeto "${project.name}"?`)) return
    setDeleting(true)
    try {
      await api.deleteTriageProject(project.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir')
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-zinc-500" />
            : <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
          }
          <span className="truncate text-sm font-medium text-zinc-200">{project.name}</span>
        </div>
        <div className="ml-4 flex flex-shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {project.contacts.length} {project.contacts.length === 1 ? 'contato' : 'contatos'}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {project.boards.length} {project.boards.length === 1 ? 'board' : 'boards'}
          </Badge>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-5" onClick={(e) => e.stopPropagation()}>
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Nome</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-950"
            />
          </div>

          {/* Contacts */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Contatos</label>
            <ContactEditor contacts={contacts} onChange={setContacts} />
          </div>

          {/* Boards */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Boards</label>
            <BoardEditor boards={boards} onChange={setBoards} />
          </div>

          {/* Repo URL */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Repo URL</label>
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="bg-zinc-950"
            />
          </div>

          {/* Context */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Contexto para o classificador</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              placeholder="Descricao do projeto para o LLM classificador..."
              className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
            />
          </div>

          {/* Recent items */}
          <RecentItems projectId={project.id} />

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Excluindo...' : 'Excluir projeto'}
            </Button>
            <Button size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Salvando...' : 'Salvar alteracoes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface ProjectsTableProps {
  projects: TriageProject[]
  onRefresh: () => void
}

export function ProjectsTable({ projects, onRefresh }: ProjectsTableProps) {
  const [showNewForm, setShowNewForm] = useState(false)

  function handleCreated() {
    setShowNewForm(false)
    onRefresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">Projetos de triagem</CardTitle>
        {!showNewForm && (
          <Button size="sm" onClick={() => setShowNewForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Novo projeto
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {showNewForm && (
          <NewProjectForm
            onCreated={handleCreated}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        {projects.length === 0 && !showNewForm && (
          <p className="py-8 text-center text-sm text-zinc-600">
            Nenhum projeto configurado. Crie o primeiro projeto acima.
          </p>
        )}

        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            onUpdated={onRefresh}
            onDeleted={onRefresh}
          />
        ))}
      </CardContent>
    </Card>
  )
}
