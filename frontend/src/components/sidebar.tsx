import { Link, useLocation } from "react-router-dom"
import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import {
    LayoutDashboard,
    FolderOpen,
    User,
    Settings,
    Cloud,
    HardDrive,
    Share2,
    Trash2,
    Star,
    Clock,
    Search,
    Bell,
    ChevronDown,
    Menu,
    X,
    LogOut,
    Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useAuth } from "@/contexts/auth-context"

// Sidebar context for mobile toggle
type SidebarContextType = {
    isOpen: boolean
    toggle: () => void
    close: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function useSidebar() {
    const context = useContext(SidebarContext)
    if (!context) {
        throw new Error("useSidebar must be used within a SidebarProvider")
    }
    return context
}

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)

    const toggle = () => setIsOpen(!isOpen)
    const close = () => setIsOpen(false)

    // Close sidebar on route change
    const location = useLocation()
    useEffect(() => {
        close()
    }, [location.pathname])

    // Close sidebar on window resize to desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 1024) {
                close()
            }
        }
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    // Prevent body scroll when sidebar is open on mobile
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden"
        } else {
            document.body.style.overflow = ""
        }
        return () => {
            document.body.style.overflow = ""
        }
    }, [isOpen])

    return (
        <SidebarContext.Provider value={{ isOpen, toggle, close }}>
            {children}
        </SidebarContext.Provider>
    )
}

const mainNavItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Files", href: "/files", icon: FolderOpen },
    { name: "Shared", href: "/shared", icon: Share2 },
    { name: "Starred", href: "/starred", icon: Star },
    { name: "Recent", href: "/recent", icon: Clock },
    { name: "Trash", href: "/trash", icon: Trash2 },
]

const accountNavItems = [
    { name: "Profile", href: "/profile", icon: User },
    { name: "Settings", href: "/settings", icon: Settings },
]

export function Sidebar() {
    const location = useLocation()
    const { isOpen, close } = useSidebar()
    const { user, isAuthenticated, logout } = useAuth()

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={cn(
                    "fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={close}
                aria-hidden="true"
            />

            {/* Sidebar */}
            <aside
                className={cn(
                    "fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out",
                    "lg:translate-x-0 lg:z-40",
                    isOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                {/* Logo */}
                <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4 lg:px-6">
                    <div className="flex items-center gap-2">
                        <Cloud className="h-8 w-8 text-primary" />
                        <span className="text-xl font-semibold text-sidebar-foreground">Cloud-Pi</span>
                    </div>
                    {/* Close button for mobile */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden text-sidebar-foreground hover:bg-sidebar-accent"
                        onClick={close}
                        aria-label="Close sidebar"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Search */}
                <div className="p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search..."
                            className="pl-9 bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                {/* Main Navigation */}
                <nav className="flex-1 space-y-1 px-3 overflow-y-auto">
                    <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Storage</div>
                    {mainNavItems.map((item) => {
                        const isActive = location.pathname === item.href
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-sidebar-accent text-sidebar-primary"
                                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                                )}
                            >
                                <item.icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        )
                    })}

                    <div className="mb-2 mt-6 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Account</div>
                    {accountNavItems.map((item) => {
                        const isActive = location.pathname === item.href
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-sidebar-accent text-sidebar-primary"
                                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                                )}
                            >
                                <item.icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        )
                    })}
                    
                    {/* Admin link - only for admin users */}
                    {user?.is_admin === 1 && (
                        <Link
                            to="/admin"
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                location.pathname === "/admin"
                                    ? "bg-sidebar-accent text-sidebar-primary"
                                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                            )}
                        >
                            <Shield className="h-5 w-5" />
                            Admin
                        </Link>
                    )}
                </nav>

                {/* Storage Progress */}
                <div className="border-t border-sidebar-border p-4">
                    <div className="flex items-center gap-2 text-sm text-sidebar-foreground">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <span>Storage</span>
                    </div>
                    <Progress value={53} className="mt-2 h-2" />
                    <p className="mt-2 text-xs text-muted-foreground">68.4 GB of 128 GB used</p>
                </div>

                {/* User Menu */}
                <div className="border-t border-sidebar-border p-4">
                    {!isAuthenticated ? (
                        <Button asChild variant="ghost" className="w-full justify-start gap-3 px-2 hover:bg-sidebar-accent">
                            <Link to="/auth/login">
                                <Avatar className="h-8 w-8">
                                    <AvatarFallback className="bg-primary text-primary-foreground">?</AvatarFallback>
                                </Avatar>
                                <div className="flex flex-1 flex-col items-start text-sm">
                                    <span className="font-medium text-sidebar-foreground">Sign In</span>
                                    <span className="text-xs text-muted-foreground">Access your cloud</span>
                                </div>
                            </Link>
                        </Button>
                    ) : (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="w-full justify-start gap-3 px-2 hover:bg-sidebar-accent">
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src="/diverse-user-avatars.png" />
                                        <AvatarFallback className="bg-primary text-primary-foreground">
                                            {user?.username?.charAt(0).toUpperCase() || 'U'}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-1 flex-col items-start text-sm">
                                        <span className="font-medium text-sidebar-foreground">{user?.username || 'User'}</span>
                                        <span className="text-xs text-muted-foreground">{user?.email || 'Local Admin'}</span>
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem asChild>
                                    <Link to="/profile">Profile</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link to="/settings">Settings</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                                    <LogOut className="h-4 w-4 mr-2" />
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </aside>
        </>
    )
}

export function TopBar() {
    const { toggle } = useSidebar()
    const location = useLocation()

    // Get page title based on current path
    const getPageTitle = () => {
        const allNavItems = [...mainNavItems, ...accountNavItems]
        const currentItem = allNavItems.find(item => item.href === location.pathname)
        return currentItem?.name || "Dashboard"
    }

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 sm:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
                {/* Hamburger menu for mobile */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    onClick={toggle}
                    aria-label="Toggle sidebar"
                >
                    <Menu className="h-5 w-5" />
                </Button>
                <h1 className="text-lg sm:text-xl font-semibold text-foreground">{getPageTitle()}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                </Button>
                <Button className="gap-2" size="sm">
                    <Cloud className="h-4 w-4" />
                    <span className="hidden sm:inline">Upload</span>
                </Button>
            </div>
        </header>
    )
}
