"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    HardDrive,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Folder,
    Cpu,
    MemoryStick,
    Server,
    Clock,
    Share2,
    Loader2,
    Thermometer,
} from "lucide-react"
import { getDashboardStats, getSystemHealth, type DashboardStats, type SystemHealth } from "@/lib/api"

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
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z')
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

const fileTypeConfig: Record<string, { icon: typeof FileText; color: string; label: string }> = {
    document: { icon: FileText, color: "text-blue-400", label: "Documents" },
    image: { icon: ImageIcon, color: "text-green-400", label: "Images" },
    video: { icon: Video, color: "text-purple-400", label: "Videos" },
    audio: { icon: Music, color: "text-yellow-400", label: "Audio" },
    archive: { icon: Archive, color: "text-orange-400", label: "Archives" },
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
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [health, setHealth] = useState<SystemHealth | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        loadData()

        // Auto-refresh health every 5 seconds
        healthInterval.current = setInterval(loadHealth, 5000)
        return () => {
            if (healthInterval.current) clearInterval(healthInterval.current)
        }
    }, [])

    async function loadData() {
        setIsLoading(true)
        try {
            const [statsData, healthData] = await Promise.all([
                getDashboardStats(),
                getSystemHealth(),
            ])
            setStats(statsData)
            setHealth(healthData)
        } catch {
            // silently fail
        } finally {
            setIsLoading(false)
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const quickAccessTypes = Object.entries(fileTypeConfig).map(([type, config]) => ({
        ...config,
        type,
        count: stats?.byType[type]?.count ?? 0,
        size: stats?.byType[type]?.size ?? 0,
    }))

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
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
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
                            <CircularGauge
                                percentage={health?.cpu.temperature != null ? Math.min(100, Math.round((health.cpu.temperature / 100) * 100)) : 0}
                                label="Temp"
                                value={health?.cpu.temperature != null ? `${health.cpu.temperature}°C` : 'N/A'}
                                subtext="CPU temperature"
                                color="#f97316"
                                icon={Thermometer}
                            />
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
                            <div
                                key={item.type}
                                className="flex items-center justify-between rounded-lg bg-secondary p-3 transition-colors hover:bg-secondary/80 cursor-pointer"
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
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            {/* Recent Files */}
            {stats && stats.recentFiles.length > 0 && (
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-card-foreground">Recent Files</CardTitle>
                        <CardDescription>Recently uploaded files</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {stats.recentFiles.map((file) => {
                                const config = fileTypeConfig[file.type]
                                const Icon = config?.icon ?? FileText
                                const color = config?.color ?? "text-gray-400"
                                return (
                                    <div
                                        key={file.id}
                                        className="flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-secondary cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`rounded-lg bg-secondary p-2 ${color}`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-card-foreground">{file.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatBytes(file.size)}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-xs text-muted-foreground">{formatDate(file.created_at)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
