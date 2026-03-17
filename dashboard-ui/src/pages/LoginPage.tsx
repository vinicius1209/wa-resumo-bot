import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '@/lib/api'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function LoginPage() {
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return

    setError('')
    setLoading(true)

    try {
      // Temporarily set the token so api.status() uses it
      setToken(token.trim())
      await api.status()
      navigate('/overview')
    } catch {
      setToken('')
      setError('Token inválido ou servidor indisponível.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-zinc-100">WA-Resumo-Bot</CardTitle>
          <CardDescription className="text-zinc-500">Dashboard Admin</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="token" className="text-sm font-medium text-zinc-300">
                Token de acesso
              </label>
              <Input
                id="token"
                type="password"
                placeholder="Digite seu token"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading || !token.trim()}>
              {loading ? 'Verificando...' : 'Entrar'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
