"use client"

import { useState, useEffect, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    HardDrive,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Cpu,
    MemoryStick,
    Server,
    Clock,
    Share2,
    Loader2,
    Thermometer,
    CircleHelp,
    FolderOpen,
    AlertTriangle,
    Bell,
    CheckCheck,
    Inbox,
    Pencil,
    Trash2,
    UploadCloud,
} from "lucide-react"
import {
    getDashboardActivity,
    getDashboardStats,
    getNotifications,
    getSystemHealth,
    markAllNotificationsRead,
    markNotificationRead,
    type DashboardActivityItem,
    type DashboardStats,
    type NotificationItem,
    type SystemHealth,
} from "@/lib/api"
import { formatApiDate, parseApiDate } from "@/lib/utils"
import { StorageOverview } from "@/lib/storage-overview"
import { notifyNotificationsChanged } from "@/components/notification-bell"

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
}

function formatDate(dateString: string): string {
    const date = parseApiDate(dateString)
    if (!date) return "-"
    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - date.getTime())
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatApiDate(dateString)
}

const fileTypeConfig: Record<string, { icon: typeof FileText; color: string; label: string }> = {
    document: { icon: FileText, color: "text-blue-400", label: "Documents" },
    image: { icon: ImageIcon, color: "text-green-400", label: "Images" },
    video: { icon: Video, color: "text-purple-400", label: "Videos" },
    audio: { icon: Music, color: "text-yellow-400", label: "Audio" },
    archive: { icon: Archive, color: "text-orange-400", label: "Archives" },
    other: { icon: CircleHelp, color: "text-slate-400", label: "Other" },
}

function notificationCategory(type: string) {
    if (type.startsWith("storage.")) return "Storage"
    if (type.startsWith("share.")) return "Share"
    return "System"
}

function notificationIconClass(type: string) {
    if (type === "storage.quota_reached") return "bg-destructive/10 text-destructive"
    if (type.startsWith("storage.")) return "bg-amber-500/10 text-amber-600 dark:text-amber-300"
    if (type.startsWith("share.")) return "bg-primary/10 text-primary"
    return "bg-secondary text-muted-foreground"
}

function NotificationIcon({ type }: { type: string }) {
    if (type === "storage.quota_reached") return <AlertTriangle className="h-4 w-4" />
    if (type.startsWith("storage.")) return <HardDrive className="h-4 w-4" />
    return <Share2 className="h-4 w-4" />
}

function activityIconClass(type: string) {
    if (type.includes("trashed") || type.includes("revoked")) return "bg-destructive/10 text-destructive"
    if (type.startsWith("share.")) return "bg-primary/10 text-primary"
    if (type.includes("updated")) return "bg-amber-500/10 text-amber-600 dark:text-amber-300"
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
}

function ActivityIcon({ type }: { type: string }) {
    if (type.includes("trashed")) return <Trash2 className="h-4 w-4" />
    if (type.includes("updated")) return <Pencil className="h-4 w-4" />
    if (type.startsWith("share.")) return <Share2 className="h-4 w-4" />
    if (type.startsWith("folder.")) return <FolderOpen className="h-4 w-4" />
    return <UploadCloud className="h-4 w-4" />
}

// Circular gauge component
function CircularGauge({ percentage, label, value, subtext, color, icon: Icon }: {
    percentage: number
    label: string
    value: string
    subtext: string
    color: string
    icon: typeof Cpu
}) {
    const circumference = 2 * Math.PI * 40
    const strokeDashoffset = circumference - (percentage / 100) * circumference
    const gaugeColor = percentage > 85 ? '#ef4444' : percentage > 60 ? '#f59e0b' : color

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="relative h-24 w-24">
                <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-secondary" />
                    <circle
                        cx="50" cy="50" r="40" fill="none"
                        stroke={gaugeColor} strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-card-foreground">{percentage}%</span>
                </div>
            </div>
            <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-card-foreground">
                    <Icon className="h-3.5 w-3.5" style={{ color: gaugeColor }} />
                    {label}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{value}</p>
                <p className="text-xs text-muted-foreground">{subtext}</p>
            </div>
        </div>
    )
}

export function DashboardContent() {
    const navigate = useNavigate()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [health, setHealth] = useState<SystemHealth | null>(null)
    const [notifications, setNotifications] = useState<NotificationItem[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [activity, setActivity] = useState<DashboardActivityItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isMarkingNotifications, setIsMarkingNotifications] = useState(false)
    const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        loadData()

        // Keep the dashboard fresh without constantly poking the Pi.
        healthInterval.current = setInterval(loadHealth, 60000)
        return () => {
            if (healthInterval.current) clearInterval(healthInterval.current)
        }
    }, [])

    async function loadData() {
        setIsLoading(true)
        try {
            await Promise.all([loadStats(), loadHealth(), loadNotificationPreview(), loadActivity()])
        } catch {
            // silently fail
        } finally {
            setIsLoading(false)
        }
    }

    async function loadStats() {
        try {
            const statsData = await getDashboardStats()
            setStats(statsData)
        } catch {
            // silently fail
        }
    }

    async function loadHealth() {
        try {
            const healthData = await getSystemHealth()
            setHealth(healthData)
        } catch {
            // silently fail
        }
    }

    async function loadNotificationPreview() {
        try {
            const data = await getNotifications({ limit: 5, status: "unread" })
            setNotifications(data.notifications)
            setUnreadCount(data.unreadCount)
        } catch {
            setNotifications([])
            setUnreadCount(0)
        }
    }

    async function loadActivity() {
        try {
            const data = await getDashboardActivity(8)
            setActivity(data.activity)
        } catch {
            setActivity([])
        }
    }

    async function openNotification(notification: NotificationItem) {
        try {
            if (!notification.read_at) {
                const data = await markNotificationRead(notification.id)
                setUnreadCount(data.unreadCount)
                setNotifications((current) => current.filter((item) => item.id !== notification.id))
                notifyNotificationsChanged()
            }
        } catch {
            // Navigate even if the read-state update fails.
        }

        if (notification.link) navigate(notification.link)
    }

    async function handleMarkNotificationsRead() {
        setIsMarkingNotifications(true)
        try {
            const data = await markAllNotificationsRead()
            setUnreadCount(data.unreadCount)
            setNotifications([])
            notifyNotificationsChanged()
        } finally {
            setIsMarkingNotifications(false)
        }
    }

    function openActivity(item: DashboardActivityItem) {
        if (item.link) navigate(item.link)
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const knownQuickTypes = Object.keys(fileTypeConfig)
    const unknownTypeStats = Object.entries(stats?.byType ?? {}).reduce((total, [type, value]) => {
        if (knownQuickTypes.includes(type)) return total
        return {
            count: total.count + (Number(value.count) || 0),
            size: total.size + (Number(value.size) || 0),
        }
    }, { count: 0, size: 0 })
    const quickAccessTypes = Object.entries(fileTypeConfig).map(([type, config]) => {
        const current = stats?.byType[type] ?? { count: 0, size: 0 }
        return {
            ...config,
            type,
            count: (current.count ?? 0) + (type === "other" ? unknownTypeStats.count : 0),
            size: (current.size ?? 0) + (type === "other" ? unknownTypeStats.size : 0),
        }
    })

    return (
        <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <Card className="bg-card border-border">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Files</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-card-foreground">{stats?.totalFiles ?? 0}</div>
                        <p className="text-xs text-muted-foreground">{stats?.totalFolders ?? 0} folders</p>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Storage Used</CardTitle>
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-card-foreground">{formatBytes(stats?.totalStorage ?? 0)}</div>
                        <p className="text-xs text-muted-foreground">across all files</p>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Shared by Me</CardTitle>
                        <Share2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-card-foreground">{stats?.sharedByMe ?? 0}</div>
                        <p className="text-xs text-muted-foreground">files shared</p>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Shared with Me</CardTitle>
                        <Share2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-card-foreground">{stats?.sharedWithMe ?? 0}</div>
                        <p className="text-xs text-muted-foreground">files received</p>
                    </CardContent>
                </Card>
            </div>

            <StorageOverview
                totalStorage={stats?.totalStorage ?? 0}
                storageQuota={stats?.storageQuota ?? null}
                trashStorage={stats?.trashStorage ?? 0}
                trashFiles={stats?.trashFiles ?? 0}
                versionStorage={stats?.versionStorage ?? 0}
                typeBreakdown={stats?.byType}
                onRefreshStats={loadStats}
            />

            <div className="grid gap-6 lg:grid-cols-2">
                <Card className="bg-card border-border">
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-card-foreground">
                                <Bell className="h-5 w-5" />
                                Notifications
                            </CardTitle>
                            <CardDescription>
                                {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={unreadCount === 0 || isMarkingNotifications}
                                onClick={handleMarkNotificationsRead}
                            >
                                {isMarkingNotifications ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                                Mark read
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/notifications">View all</Link>
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {notifications.length > 0 ? (
                            <div className="space-y-2">
                                {notifications.map((notification) => (
                                    <button
                                        key={notification.id}
                                        type="button"
                                        className="flex w-full min-w-0 gap-3 rounded-lg p-3 text-left transition-colors hover:bg-secondary"
                                        onClick={() => openNotification(notification)}
                                    >
                                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${notificationIconClass(notification.type)}`}>
                                            <NotificationIcon type={notification.type} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm font-semibold text-card-foreground">{notification.title}</span>
                                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                                            </span>
                                            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>
                                            <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{notificationCategory(notification.type)}</Badge>
                                                {formatDate(notification.created_at)}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
                                <Inbox className="mb-3 h-10 w-10 text-muted-foreground" />
                                <p className="font-medium text-card-foreground">No unread notifications</p>
                                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                                    New shares and storage notices will show up here.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-card-foreground">
                            <Clock className="h-5 w-5" />
                            Activity Feed
                        </CardTitle>
                        <CardDescription>Recent file, trash, and share activity</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {activity.length > 0 ? (
                            <div className="space-y-2">
                                {activity.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex w-full min-w-0 gap-3 rounded-lg p-3 text-left transition-colors hover:bg-secondary disabled:cursor-default disabled:hover:bg-transparent"
                                        disabled={!item.link}
                                        onClick={() => openActivity(item)}
                                    >
                                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${activityIconClass(item.type)}`}>
                                            <ActivityIcon type={item.type} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-card-foreground">{item.title}</span>
                                            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
                                            <span className="mt-2 block text-[11px] text-muted-foreground">{formatDate(item.created_at)}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
                                <Clock className="mb-3 h-10 w-10 text-muted-foreground" />
                                <p className="font-medium text-card-foreground">No activity yet</p>
                                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                                    Uploads, shares, updates, and trash actions will appear here.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* System Health */}
                <Card className="lg:col-span-2 bg-card border-border">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-card-foreground flex items-center gap-2">
                                    <Server className="h-5 w-5" />
                                    System Health
                                </CardTitle>
                                <CardDescription>
                                    {health?.hostname ?? '—'} · {health?.platform ?? '—'} · Uptime: {health ? formatUptime(health.uptime) : '—'}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                Live
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className={`grid gap-6 ${health?.cpu.temperature != null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}>
                            <CircularGauge
                                percentage={health?.cpu.usage ?? 0}
                                label="CPU"
                                value={`${health?.cpu.cores ?? 0} cores`}
                                subtext={health?.cpu.model?.split(' ').slice(0, 3).join(' ') ?? ''}
                                color="#3b82f6"
                                icon={Cpu}
                            />
                            <CircularGauge
                                percentage={health?.ram.percentage ?? 0}
                                label="RAM"
                                value={`${formatBytes(health?.ram.used ?? 0)} used`}
                                subtext={`of ${formatBytes(health?.ram.total ?? 0)}`}
                                color="#8b5cf6"
                                icon={MemoryStick}
                            />
                            <CircularGauge
                                percentage={health?.disk.percentage ?? 0}
                                label="Disk"
                                value={`${formatBytes(health?.disk.used ?? 0)} used`}
                                subtext={`of ${formatBytes(health?.disk.total ?? 0)}`}
                                color="#10b981"
                                icon={HardDrive}
                            />
                            {health?.cpu.temperature != null && (
                                <CircularGauge
                                    percentage={Math.min(100, Math.round((health.cpu.temperature / 100) * 100))}
                                    label="Temp"
                                    value={`${health.cpu.temperature}°C`}
                                    subtext="CPU temperature"
                                    color="#f97316"
                                    icon={Thermometer}
                                />
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Access */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Quick Access</CardTitle>
                        <CardDescription>Browse by file type</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {quickAccessTypes.map((item) => (
                            <button
                                type="button"
                                key={item.type}
                                className="flex w-full items-center justify-between rounded-lg bg-secondary p-3 text-left transition-colors hover:bg-secondary/80"
                                onClick={() => navigate(`/files?type=${item.type}`)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`rounded-lg bg-background p-2 ${item.color}`}>
                                        <item.icon className="h-5 w-5" />
                                    </div>
                                    <span className="font-medium text-secondary-foreground">{item.label}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-sm font-medium text-secondary-foreground">{item.count}</span>
                                    {item.size > 0 && (
                                        <p className="text-xs text-muted-foreground">{formatBytes(item.size)}</p>
                                    )}
                                </div>
                            </button>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
