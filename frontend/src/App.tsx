import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy, useState, useEffect } from 'react'
import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { UploadProvider } from '@/contexts/upload-context'
import { DriveStatusProvider } from '@/contexts/drive-status-context'
import { VaultProvider } from '@/contexts/vault-context'
import { UploadManager } from '@/components/upload-manager'
import { DashboardLayout } from '@/components/dashboard-layout'
import { getSetupStatus } from '@/lib/api'
import { Loader2 } from 'lucide-react'

const DashboardPage = lazy(() => import('@/pages/dashboard').then((module) => ({ default: module.DashboardPage })))
const LoginPage = lazy(() => import('@/pages/login').then((module) => ({ default: module.LoginPage })))
const SetupPage = lazy(() => import('@/pages/setup').then((module) => ({ default: module.SetupPage })))
const RecoverPage = lazy(() => import('@/pages/recover').then((module) => ({ default: module.RecoverPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/forgot-password').then((module) => ({ default: module.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/reset-password').then((module) => ({ default: module.ResetPasswordPage })))
const FilesPage = lazy(() => import('@/pages/files').then((module) => ({ default: module.FilesPage })))
const SharedPage = lazy(() => import('@/pages/shared').then((module) => ({ default: module.SharedPage })))
const StarredPage = lazy(() => import('@/pages/starred').then((module) => ({ default: module.StarredPage })))
const RecentPage = lazy(() => import('@/pages/recent').then((module) => ({ default: module.RecentPage })))
const TrashPage = lazy(() => import('@/pages/trash').then((module) => ({ default: module.TrashPage })))
const ProfilePage = lazy(() => import('@/pages/profile').then((module) => ({ default: module.ProfilePage })))
const SettingsPage = lazy(() => import('@/pages/settings').then((module) => ({ default: module.SettingsPage })))
const NotificationsPage = lazy(() => import('@/pages/notifications').then((module) => ({ default: module.NotificationsPage })))
const AdminPage = lazy(() => import('@/pages/admin'))
const SearchPage = lazy(() => import('@/pages/search').then((module) => ({ default: module.SearchPage })))
const NotFoundPage = lazy(() => import('@/pages/not-found').then((module) => ({ default: module.NotFoundPage })))
const ShareViewPage = lazy(() => import('@/pages/share-view').then((module) => ({ default: module.ShareViewPage })))

function RouteLoading() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    )
}

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
        return <RouteLoading />
    }

    // If setup is required, only show setup page
    if (setupRequired) {
        return (
            <Suspense fallback={<RouteLoading />}>
                <Routes>
                    <Route path="/setup" element={<SetupPage />} />
                    <Route path="*" element={<Navigate to="/setup" replace />} />
                </Routes>
            </Suspense>
        )
    }

    return (
        <Suspense fallback={<RouteLoading />}>
            <Routes>
                {/* Auth routes - no layout */}
                <Route path="/auth/login" element={<LoginPage />} />
                <Route path="/auth/recover" element={<RecoverPage />} />
                <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/setup" element={<Navigate to="/auth/login" replace />} />

                {/* Public share view - no auth needed */}
                <Route path="/s/:link" element={<ShareViewPage />} />
                <Route path="/share/:link" element={<ShareViewPage />} />

                {/* Dashboard routes - with layout */}
                <Route path="/" element={<DashboardLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="files" element={<FilesPage />} />
                    <Route path="shares" element={<SharedPage />} />
                    <Route path="shares/outgoing" element={<SharedPage />} />
                    <Route path="shares/incoming" element={<SharedPage />} />
                    <Route path="shares/:shareId" element={<SharedPage />} />
                    <Route path="shared" element={<Navigate to="/shares" replace />} />
                    <Route path="starred" element={<StarredPage />} />
                    <Route path="recent" element={<RecentPage />} />
                    <Route path="trash" element={<TrashPage />} />
                    <Route path="search" element={<SearchPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="admin" element={<AdminPage />} />
                </Route>

                {/* 404 - catch all */}
                <Route path="*" element={<NotFoundPage />} />
            </Routes>
        </Suspense>
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
