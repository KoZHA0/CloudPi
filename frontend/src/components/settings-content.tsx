"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bell, Globe, Palette, HardDrive, Trash2, Download, Server, Database, Loader2 } from "lucide-react"
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

export function SettingsContent() {
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [health, setHealth] = useState<SystemHealth | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const [notifications, setNotifications] = useState({
        email: false,
        fileChanges: true,
        storageWarning: true,
    })

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        try {
            const [statsData, healthData] = await Promise.all([
                getDashboardStats(),
                getSystemHealth(),
            ])
            setStats(statsData)
            setHealth(healthData)
        } catch (error) {
            console.error("Failed to load settings data", error)
        } finally {
            setIsLoading(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    // Calculate storage percentage (assuming 64GB total for now, or use disk total if available)
    const totalDiskSpace = health?.disk.total || 64 * 1024 * 1024 * 1024 // Fallback to 64GB
    const usedStorage = stats?.totalStorage || 0
    const storagePercent = Math.min(100, Math.round((usedStorage / totalDiskSpace) * 100))

    return (
        <div className="space-y-6 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Settings</h1>
                <p className="text-muted-foreground">Manage your personal cloud settings</p>
            </div>

            <Tabs defaultValue="server" className="space-y-6">
                <TabsList className="bg-secondary">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="server">Server</TabsTrigger>
                    <TabsTrigger value="notifications">Notifications</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-6">
                    {/* Appearance */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Palette className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Appearance</CardTitle>
                            </div>
                            <CardDescription>Customize how your cloud looks</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-base">Theme</Label>
                                    <p className="text-sm text-muted-foreground">Select your preferred theme</p>
                                </div>
                                <Select defaultValue="dark">
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">Light</SelectItem>
                                        <SelectItem value="dark">Dark</SelectItem>
                                        <SelectItem value="system">System</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Language & Region */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Globe className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Language & Region</CardTitle>
                            </div>
                            <CardDescription>Set your language and regional preferences</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Language</Label>
                                    <Select defaultValue="en">
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="en">English</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Storage */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <HardDrive className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Storage</CardTitle>
                            </div>
                            <CardDescription>Manage your local storage</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 rounded-lg bg-secondary">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-secondary-foreground">Storage Used</span>
                                    <span className="text-sm text-muted-foreground">
                                        {formatBytes(usedStorage)} / {formatBytes(totalDiskSpace)}
                                    </span>
                                </div>
                                <div className="w-full bg-background rounded-full h-2">
                                    <div
                                        className="bg-primary h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${storagePercent}%` }}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" className="gap-2 bg-transparent">
                                    <Trash2 className="h-4 w-4" />
                                    Clear Cache
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="server" className="space-y-6">
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Server className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Server Information</CardTitle>
                            </div>
                            <CardDescription>Your self-hosted server details</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="p-4 rounded-lg bg-secondary">
                                    <p className="text-sm text-muted-foreground">Hostname</p>
                                    <p className="font-medium text-secondary-foreground">{health?.hostname || 'Unknown'}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-secondary">
                                    <p className="text-sm text-muted-foreground">IP Address</p>
                                    <p className="font-medium text-secondary-foreground">{health?.ip || 'Unknown'}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-secondary">
                                    <p className="text-sm text-muted-foreground">Platform</p>
                                    <p className="font-medium text-secondary-foreground capitalize">{health?.platform || 'Unknown'}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-secondary">
                                    <p className="text-sm text-muted-foreground">Uptime</p>
                                    <p className="font-medium text-secondary-foreground">
                                        {health ? formatUptime(health.uptime) : 'Unknown'}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Database className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Data Management</CardTitle>
                            </div>
                            <CardDescription>Backup and maintenance options</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
                                <div>
                                    <p className="font-medium text-secondary-foreground">Last Backup</p>
                                    <p className="text-sm text-muted-foreground">No backups yet</p>
                                </div>
                                <Button variant="outline">Backup Now</Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-6">
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Bell className="h-5 w-5 text-primary" />
                                <CardTitle className="text-card-foreground">Notification Preferences</CardTitle>
                            </div>
                            <CardDescription>Choose how you want to be notified</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-base">Email Notifications</Label>
                                    <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                                </div>
                                <Switch
                                    checked={notifications.email}
                                    onCheckedChange={(checked) => setNotifications({ ...notifications, email: checked })}
                                />
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-base">File Change Alerts</Label>
                                    <p className="text-sm text-muted-foreground">Get notified when files are modified</p>
                                </div>
                                <Switch
                                    checked={notifications.fileChanges}
                                    onCheckedChange={(checked) => setNotifications({ ...notifications, fileChanges: checked })}
                                />
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-base">Storage Warning</Label>
                                    <p className="text-sm text-muted-foreground">Alert when storage is almost full</p>
                                </div>
                                <Switch
                                    checked={notifications.storageWarning}
                                    onCheckedChange={(checked) => setNotifications({ ...notifications, storageWarning: checked })}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
