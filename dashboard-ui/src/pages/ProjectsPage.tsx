import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { TriageProject } from '@/lib/api'
import { Header } from '@/components/layout/Header'
import { ProjectsTable } from '@/components/dashboard/ProjectsTable'

export function ProjectsPage() {
  const [projects, setProjects] = useState<TriageProject[]>([])

  const fetchProjects = useCallback(async () => {
    try {
      const data = await api.triageProjects()
      setProjects(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title="Projetos"
        subtitle="Gerencie projetos e mapeie contatos do WhatsApp"
      />
      <div className="p-6">
        <ProjectsTable projects={projects} onRefresh={fetchProjects} />
      </div>
    </div>
  )
}
