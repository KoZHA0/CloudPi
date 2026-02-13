import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { AuthProvider } from '@/contexts/auth-context'
import { DashboardLayout } from '@/components/dashboard-layout'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { SetupPage } from '@/pages/setup'
import { FilesPage } from '@/pages/files'
import { SharedPage } from '@/pages/shared'
import { StarredPage } from '@/pages/starred'
import { RecentPage } from '@/pages/recent'
import { TrashPage } from '@/pages/trash'
import { ProfilePage } from '@/pages/profile'
import { SettingsPage } from '@/pages/settings'
import AdminPage from '@/pages/admin'
import { NotFoundPage } from '@/pages/not-found'
import { ShareViewPage } from '@/pages/share-view'
import { getSetupStatus } from '@/lib/api'
import { Loader2 } from 'lucide-react'

function AppContent() {
    const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

    useEffect(() => {
        checkSetupStatus()
    }, [])

    async function checkSetupStatus() {
        try {
            const status = await getSetupStatus()
            setSetupRequired(status.setupRequired)
        } catch {
            // If backend is down, assume no setup required
            setSetupRequired(false)
        }
    }

    // Show loading while checking setup status
    if (setupRequired === null) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    // If setup is required, only show setup page
    if (setupRequired) {
        return (
            <Routes>
                <Route path="/setup" element={<SetupPage />} />
                <Route path="*" element={<Navigate to="/setup" replace />} />
            </Routes>
        )
    }

    return (
        <Routes>
            {/* Auth routes - no layout */}
            <Route path="/auth/login" element={<LoginPage />} />
            <Route path="/setup" element={<Navigate to="/auth/login" replace />} />

            {/* Public share view - no auth needed */}
            <Route path="/share/:link" element={<ShareViewPage />} />

            {/* Dashboard routes - with layout */}
            <Route path="/" element={<DashboardLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="files" element={<FilesPage />} />
                <Route path="shared" element={<SharedPage />} />
                <Route path="starred" element={<StarredPage />} />
                <Route path="recent" element={<RecentPage />} />
                <Route path="trash" element={<TrashPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin" element={<AdminPage />} />
            </Route>

            {/* 404 - catch all */}
            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    )
}

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppContent />
            </BrowserRouter>
        </AuthProvider>
    )
}

export default App
