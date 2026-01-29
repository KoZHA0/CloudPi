import { Outlet, Navigate } from "react-router-dom"
import { Sidebar, TopBar, SidebarProvider } from "@/components/sidebar"
import { useAuth } from "@/contexts/auth-context"
import { Loader2 } from "lucide-react"

export function DashboardLayout() {
    const { isAuthenticated, isLoading } = useAuth()

    // Show loading spinner while checking auth
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Navigate to="/auth/login" replace />
    }

    return (
        <SidebarProvider>
            <div className="flex min-h-screen bg-background">
                <Sidebar />
                <div className="flex-1 lg:ml-64">
                    <TopBar />
                    <main className="p-4 sm:p-6">
                        <Outlet />
                    </main>
                </div>
            </div>
        </SidebarProvider>
    )
}
