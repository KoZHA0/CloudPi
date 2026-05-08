import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { UploadProvider } from '@/contexts/upload-context'
import { DriveStatusProvider } from '@/contexts/drive-status-context'
import { VaultProvider } from '@/contexts/vault-context'
import { UploadManager } from '@/components/upload-manager'
import { DashboardLayout } from '@/components/dashboard-layout'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { SetupPage } from '@/pages/setup'
import { RecoverPage } from '@/pages/recover'
import { ForgotPasswordPage } from '@/pages/forgot-password'
import { ResetPasswordPage } from '@/pages/reset-password'
import { FilesPage } from '@/pages/files'
import { SharedPage } from '@/pages/shared'
import { StarredPage } from '@/pages/starred'
import { RecentPage } from '@/pages/recent'
import { TrashPage } from '@/pages/trash'
import { ProfilePage } from '@/pages/profile'
import { SettingsPage } from '@/pages/settings'
import AdminPage from '@/pages/admin'
import { SearchPage } from '@/pages/search'
import { NotFoundPage } from '@/pages/not-found'
import { ShareViewPage } from '@/pages/share-view'
import { getSetupStatus } from '@/lib/api'
import { Loader2 } from 'lucide-react'

function AppContent() {
    const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

    useEffect(() => {
        async function checkSetupStatus() {
            try {
                const status = await getSetupStatus()
                setSetupRequired(status.setupRequired)
            } catch {
                // If backend is down, assume no setup required
                setSetupRequired(false)
            }
        }

        checkSetupStatus()
    }, [])

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
            <Route path="/auth/recover" element={<RecoverPage />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
                <Route path="search" element={<SearchPage />} />
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
        <ThemeProvider>
            <AuthProvider>
                <VaultProvider>
                    <UploadProvider>
                        <DriveStatusProvider>
                            <BrowserRouter>
                                <AppContent />
                                <UploadManager />
                            </BrowserRouter>
                        </DriveStatusProvider>
                    </UploadProvider>
                </VaultProvider>
            </AuthProvider>
        </ThemeProvider>
    )
}

export default App
