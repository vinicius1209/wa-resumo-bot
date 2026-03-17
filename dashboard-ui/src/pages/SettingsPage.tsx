import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SettingsPage() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.config()
      setConfig(data)
      setEditValues(data)
    } catch { /* ignore */ }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  function handleValueChange(key: string, value: string) {
    setEditValues((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSaveKey(key: string) {
    try {
      await api.updateConfig({ [key]: editValues[key] })
      setConfig((prev) => ({ ...prev, [key]: editValues[key] }))
      showToast(`"${key}" salvo com sucesso.`)
    } catch (err) {
      showToast(`Erro ao salvar "${key}": ${err instanceof Error ? err.message : 'desconhecido'}`)
    }
  }

  async function handleAddNew() {
    const key = newKey.trim()
    const value = newValue.trim()
    if (!key) return

    try {
      await api.updateConfig({ [key]: value })
      setConfig((prev) => ({ ...prev, [key]: value }))
      setEditValues((prev) => ({ ...prev, [key]: value }))
      setNewKey('')
      setNewValue('')
      showToast(`"${key}" adicionado com sucesso.`)
    } catch (err) {
      showToast(`Erro ao adicionar "${key}": ${err instanceof Error ? err.message : 'desconhecido'}`)
    }
  }

  const configKeys = Object.keys(config).sort()
  const hasChanges = (key: string) => editValues[key] !== config[key]

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="Configuração" subtitle="Editar configurações dinâmicas" />

      <div className="space-y-6 p-6">
        {/* Toast notification */}
        {toast && (
          <div className="fixed right-6 top-6 z-50 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 shadow-lg">
            {toast}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Carregando configuração...</p>
        ) : (
          <>
            {/* Existing config keys */}
            <Card>
              <CardContent className="pt-6">
                {configKeys.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-600">
                    Nenhuma configuração encontrada
                  </p>
                ) : (
                  <div className="space-y-3">
                    {configKeys.map((key) => (
                      <div key={key} className="flex items-center gap-3">
                        <label className="w-56 shrink-0 truncate text-sm font-medium text-zinc-400" title={key}>
                          {key}
                        </label>
                        <Input
                          value={editValues[key] ?? ''}
                          onChange={(e) => handleValueChange(key, e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          variant={hasChanges(key) ? 'default' : 'secondary'}
                          disabled={!hasChanges(key)}
                          onClick={() => handleSaveKey(key)}
                        >
                          Salvar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add new key-value pair */}
            <Card>
              <CardContent className="pt-6">
                <p className="mb-4 text-sm font-medium text-zinc-400">Adicionar nova configuração</p>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-zinc-500">Chave</label>
                    <Input
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="NOME_DA_CHAVE"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-zinc-500">Valor</label>
                    <Input
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="valor"
                    />
                  </div>
                  <Button onClick={handleAddNew} disabled={!newKey.trim()}>
                    Adicionar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
