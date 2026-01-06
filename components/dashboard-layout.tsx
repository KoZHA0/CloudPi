import type React from "react"
import { Sidebar, TopBar, SidebarProvider } from "@/components/sidebar"

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="lg:pl-64 transition-all duration-300">
          <TopBar />
          <main className="p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  )
}
