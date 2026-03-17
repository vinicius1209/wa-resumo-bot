import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { getToken } from '@/lib/api'
import { useWebSocket } from '@/hooks/use-websocket'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { LoginPage } from '@/pages/LoginPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { ChatPage } from '@/pages/ChatPage'
import { GroupsPage } from '@/pages/GroupsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ConversationsPage } from '@/pages/ConversationsPage'

function ProtectedRoute() {
  const token = getToken()
  if (!token) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

function DashboardLayout() {
  const { connected } = useWebSocket()

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <AppSidebar connected={connected} />
      <main className="flex flex-1 flex-col overflow-auto">
        <Outlet context={{ connected }} />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/conversations" element={<ConversationsPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
