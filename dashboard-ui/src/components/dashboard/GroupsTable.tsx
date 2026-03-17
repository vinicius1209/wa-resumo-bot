import { useState, useMemo, useEffect } from 'react'
import type { GroupSettings } from '@/lib/api'
import { shortenGroupId } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { DataTable, type ColumnDef } from '@/components/ui/data-table'

interface GroupsTableProps {
  groups: GroupSettings[]
  onToggle: (id: string, allow: boolean) => void
  onUpdateFeatures: (id: string, features: Record<string, boolean>) => void
  onSaveNotes: (id: string, notes: string) => void
}

const FEATURES = [
  'resumo',
  'quiz',
  'retro',
  'links',
  'temperatura',
  'persona',
  'meperdi',
  'compromissos',
] as const

function parseFeatures(json: string | null): Record<string, boolean> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function GroupsTable({ groups, onToggle, onUpdateFeatures, onSaveNotes }: GroupsTableProps) {
  const [localFeatures, setLocalFeatures] = useState<Record<string, boolean>>({})
  const [localNotes, setLocalNotes] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)

  // Sync local state when a row expands
  useEffect(() => {
    if (activeGroupId) {
      const group = groups.find((g) => g.group_id === activeGroupId)
      if (group) {
        setLocalFeatures(parseFeatures(group.features_json))
        setLocalNotes(group.notes ?? '')
      }
    }
  }, [activeGroupId, groups])

  const columns = useMemo<ColumnDef<GroupSettings, unknown>[]>(
    () => [
      {
        accessorKey: 'group_name',
        header: 'Grupo',
        cell: ({ row }) => (
          <span className="text-zinc-300">
            {row.original.group_name || shortenGroupId(row.original.group_id)}
          </span>
        ),
        filterFn: (row, _columnId, filterValue: string) => {
          const name = row.original.group_name || row.original.group_id
          return name.toLowerCase().includes(filterValue.toLowerCase())
        },
      },
      {
        accessorKey: 'allowed',
        header: 'Status',
        cell: ({ row }) => {
          const isAllowed = row.original.allowed === 1
          const isNew = !isAllowed && !row.original.features_json && !row.original.notes
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant={isAllowed ? 'success' : 'destructive'}>
                {isAllowed ? 'Ativo' : 'Inativo'}
              </Badge>
              {isNew && <Badge variant="outline">Novo</Badge>}
            </div>
          )
        },
        sortingFn: 'basic',
      },
      {
        id: 'actions',
        header: 'Ação',
        enableSorting: false,
        cell: ({ row }) => {
          const isAllowed = row.original.allowed === 1
          return (
            <Button
              size="sm"
              variant={isAllowed ? 'destructive' : 'default'}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(row.original.group_id, !isAllowed)
              }}
            >
              {isAllowed ? 'Bloquear' : 'Permitir'}
            </Button>
          )
        },
      },
    ],
    [onToggle]
  )

  function handleRowClick(group: GroupSettings) {
    setActiveGroupId((prev) => (prev === group.group_id ? null : group.group_id))
  }

  function renderSubRow(group: GroupSettings) {
    return (
      <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
        {/* Feature toggles */}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">Funcionalidades</p>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((feat) => {
              const enabled = localFeatures[feat] ?? true
              return (
                <button
                  key={feat}
                  type="button"
                  onClick={() =>
                    setLocalFeatures((prev) => ({ ...prev, [feat]: !(prev[feat] ?? true) }))
                  }
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    enabled
                      ? 'border-blue-500/50 bg-blue-500/20 text-blue-400'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-500 hover:text-zinc-400'
                  }`}
                >
                  {feat}
                </button>
              )
            })}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => onUpdateFeatures(group.group_id, localFeatures)}
          >
            Salvar funcionalidades
          </Button>
        </div>

        {/* Notes */}
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">Notas</p>
          <textarea
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
            placeholder="Notas sobre este grupo..."
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-1"
            onClick={() => onSaveNotes(group.group_id, localNotes)}
          >
            Salvar notas
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">Grupos</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={groups}
          filterColumn="group_name"
          filterPlaceholder="Buscar grupo..."
          renderSubRow={renderSubRow}
          getRowCanExpand={() => true}
          onRowClick={handleRowClick}
          expandedRowId={activeGroupId}
          getRowId={(row) => row.group_id}
        />
      </CardContent>
    </Card>
  )
}
