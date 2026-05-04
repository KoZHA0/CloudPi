"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Bell, Globe, Palette, HardDrive, Trash2, Server, Database, Loader2, Shield, Save, CheckCircle2, Plus, Usb, Mail, Send } from "lucide-react"
import { getDashboardStats, getSystemHealth, getRateLimitSettings, updateSettings, testSmtpSettings, getStorageSources, addStorageSource, removeStorageSource, type DashboardStats, type RateLimitSettings, type SystemHealth, type StorageSource } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

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
    const { user } = useAuth()
    const isAdmin = user?.is_admin === 1

    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [health, setHealth] = useState<SystemHealth | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Rate limit settings (admin only)
    const [rateLimits, setRateLimits] = useState({
        rate_limit_api_max: '100',
        rate_limit_api_window: '15',
        rate_limit_auth_max: '10',
        rate_limit_auth_window: '15',
        rate_limit_upload_max: '10',
        rate_limit_upload_window: '15',
    })
    const [smtpSettings, setSmtpSettings] = useState({
        smtp_host: '',
        smtp_port: '587',
        smtp_user: '',
        smtp_pass: '',
        smtp_from_email: '',
    })
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState('')
    const [isTestingSmtp, setIsTestingSmtp] = useState(false)
    const [smtpTestMessage, setSmtpTestMessage] = useState('')

    // Storage sources (admin only)
    const [storageSources, setStorageSources] = useState<StorageSource[]>([])
    const [showAddStorage, setShowAddStorage] = useState(false)
    const [newStoragePath, setNewStoragePath] = useState('')
    const [newStorageLabel, setNewStorageLabel] = useState('')
    const [storageMessage, setStorageMessage] = useState('')
    const [isAddingStorage, setIsAddingStorage] = useState(false)

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

            // Set rate limit settings if admin
            if (isAdmin) {
                const [settingsData, storageData] = await Promise.all([
                    getRateLimitSettings(),
                    getStorageSources(),
                ])
                const s: RateLimitSettings = settingsData.settings
                setRateLimits({
                    rate_limit_api_max: s.rate_limit_api_max?.value || '100',
                    rate_limit_api_window: s.rate_limit_api_window?.value || '15',
                    rate_limit_auth_max: s.rate_limit_auth_max?.value || '10',
                    rate_limit_auth_window: s.rate_limit_auth_window?.value || '15',
                    rate_limit_upload_max: s.rate_limit_upload_max?.value || '10',
                    rate_limit_upload_window: s.rate_limit_upload_window?.value || '15',
                })
                setSmtpSettings({
                    smtp_host: s.smtp_host?.value || '',
                    smtp_port: s.smtp_port?.value || '587',
                    smtp_user: s.smtp_user?.value || '',
                    smtp_pass: s.smtp_pass?.value ? '********' : '',
                    smtp_from_email: s.smtp_from_email?.value || '',
                })
                setStorageSources(storageData.sources)
            }
        } catch (error) {
            console.error("Failed to load settings data", error)
        } finally {
            setIsLoading(false)
        }
    }

    async function handleSaveRateLimits() {
        setIsSaving(true)
        setSaveMessage('')
        try {
            await updateSettings(rateLimits)
            setSaveMessage('Settings saved successfully!')
            setTimeout(() => setSaveMessage(''), 3000)
        } catch (error: unknown) {
            setSaveMessage(getErrorMessage(error, 'Failed to save settings'))
        } finally {
            setIsSaving(false)
        }
    }

    async function handleSaveSmtpSettings() {
        setIsSaving(true)
        setSaveMessage('')
        try {
            await updateSettings(smtpSettings)
            setSaveMessage('Email settings saved successfully!')
            setTimeout(() => setSaveMessage(''), 3000)
        } catch (error: unknown) {
            setSaveMessage(getErrorMessage(error, 'Failed to save email settings'))
        } finally {
            setIsSaving(false)
        }
    }

    async function handleTestSmtp() {
        setIsTestingSmtp(true)
        setSmtpTestMessage('')
        try {
            const result = await testSmtpSettings(smtpSettings)
            setSmtpTestMessage(result.message)
        } catch (error: unknown) {
            setSmtpTestMessage(getErrorMessage(error, 'SMTP test failed'))
        } finally {
            setIsTestingSmtp(false)
        }
    }

    async function handleAddStorage() {
        if (!newStoragePath.trim() || !newStorageLabel.trim()) return
        setIsAddingStorage(true)
        setStorageMessage('')
        try {
            const result = await addStorageSource(newStoragePath.trim(), newStorageLabel.trim())
            setStorageMessage(result.message)
            setShowAddStorage(false)
            setNewStoragePath('')
            setNewStorageLabel('')
            // Refresh storage sources
            const data = await getStorageSources()
            setStorageSources(data.sources)
        } catch (error: unknown) {
            setStorageMessage(getErrorMessage(error, 'Failed to add storage'))
        } finally {
            setIsAddingStorage(false)
        }
    }

    async function handleRemoveStorage(id: string) {
        try {
            await removeStorageSource(id)
            const data = await getStorageSources()
            setStorageSources(data.sources)
            setStorageMessage('Storage source removed')
            setTimeout(() => setStorageMessage(''), 3000)
        } catch (error: unknown) {
            setStorageMessage(getErrorMessage(error, 'Failed to remove storage'))
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

                    {/* Storage Sources (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <HardDrive className="h-5 w-5 text-primary" />
                                        <CardTitle className="text-card-foreground">Storage Sources</CardTitle>
                                    </div>
                                    <Button size="sm" className="gap-2" onClick={() => setShowAddStorage(true)}>
                                        <Plus className="h-4 w-4" />
                                        Add Storage
                                    </Button>
                                </div>
                                <CardDescription>Manage internal and external storage drives</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {storageSources.map(source => {
                                    const usedPercent = source.total_bytes > 0 
                                        ? Math.round((source.used_bytes / source.total_bytes) * 100) 
                                        : 0
                                    return (
                                        <div key={source.id} className="p-4 rounded-lg bg-secondary space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    {source.type === 'internal' ? (
                                                        <Server className="h-4 w-4 text-muted-foreground" />
                                                    ) : (
                                                        <Usb className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                    <span className="font-medium text-secondary-foreground">{source.label}</span>
                                                    {source.is_accessible ? (
                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Online</span>
                                                    ) : (
                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">Offline</span>
                                                    )}
                                                </div>
                                                {source.type !== 'internal' && (
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                        onClick={() => handleRemoveStorage(source.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground font-mono">{source.path}</p>
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>{source.file_count} file(s) · {formatBytes(source.used_bytes)} used</span>
                                                {source.total_bytes > 0 && (
                                                    <span>{formatBytes(source.total_bytes - source.used_bytes)} free</span>
                                                )}
                                            </div>
                                            {source.total_bytes > 0 && (
                                                <div className="w-full bg-background rounded-full h-1.5">
                                                    <div
                                                        className={`h-1.5 rounded-full transition-all ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-yellow-500' : 'bg-primary'}`}
                                                        style={{ width: `${usedPercent}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                                {storageMessage && (
                                    <p className={`text-sm ${storageMessage.includes('Cannot') || storageMessage.includes('Failed') ? 'text-red-500' : 'text-green-500'}`}>
                                        {storageMessage}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Add Storage Dialog */}
                    <Dialog open={showAddStorage} onOpenChange={setShowAddStorage}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add External Storage</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Drive Path</Label>
                                    <Input
                                        placeholder="e.g. /mnt/usb1 or E:\\"
                                        value={newStoragePath}
                                        onChange={(e) => setNewStoragePath(e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">The mount point or drive letter where the external drive is accessible</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Label</Label>
                                    <Input
                                        placeholder="e.g. My USB Drive"
                                        value={newStorageLabel}
                                        onChange={(e) => setNewStorageLabel(e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">A friendly name to identify this drive</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowAddStorage(false)}>Cancel</Button>
                                <Button onClick={handleAddStorage} disabled={isAddingStorage || !newStoragePath.trim() || !newStorageLabel.trim()} className="gap-2">
                                    {isAddingStorage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                    {isAddingStorage ? 'Adding...' : 'Add Storage'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Rate Limits (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Shield className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-card-foreground">Rate Limits</CardTitle>
                                </div>
                                <CardDescription>Control how many requests users can make per time window</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* API Rate Limit */}
                                <div className="p-4 rounded-lg bg-secondary space-y-3">
                                    <p className="font-medium text-secondary-foreground">API Requests</p>
                                    <p className="text-sm text-muted-foreground">Limits all API calls per IP address</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Max requests</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_api_max}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_api_max: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Window (minutes)</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_api_window}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_api_window: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Auth Rate Limit */}
                                <div className="p-4 rounded-lg bg-secondary space-y-3">
                                    <p className="font-medium text-secondary-foreground">Login Attempts</p>
                                    <p className="text-sm text-muted-foreground">Limits login and recovery attempts per IP (brute-force protection)</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Max attempts</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_auth_max}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_auth_max: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Window (minutes)</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_auth_window}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_auth_window: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Upload Rate Limit */}
                                <div className="p-4 rounded-lg bg-secondary space-y-3">
                                    <p className="font-medium text-secondary-foreground">File Uploads</p>
                                    <p className="text-sm text-muted-foreground">Limits upload requests per IP to protect disk I/O</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Max uploads</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_upload_max}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_upload_max: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Window (minutes)</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={rateLimits.rate_limit_upload_window}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_upload_window: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Save Button */}
                                <div className="flex items-center gap-3">
                                    <Button onClick={handleSaveRateLimits} disabled={isSaving} className="gap-2">
                                        {isSaving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                        {isSaving ? 'Saving...' : 'Save Changes'}
                                    </Button>
                                    {saveMessage && (
                                        <span className={`text-sm flex items-center gap-1 ${
                                            saveMessage.includes('success') ? 'text-green-500' : 'text-red-500'
                                        }`}>
                                            {saveMessage.includes('success') && <CheckCircle2 className="h-4 w-4" />}
                                            {saveMessage}
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Email Server Configuration (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Mail className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-card-foreground">Email Server (SMTP)</CardTitle>
                                </div>
                                <CardDescription>Configure an email server to allow password recovery and system notifications</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="p-4 rounded-lg bg-secondary space-y-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">SMTP Server Host</Label>
                                            <Input
                                                placeholder="e.g. smtp.gmail.com"
                                                value={smtpSettings.smtp_host}
                                                onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_host: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">SMTP Port</Label>
                                            <Input
                                                type="number"
                                                placeholder="e.g. 587 or 465"
                                                value={smtpSettings.smtp_port}
                                                onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_port: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">SMTP Username</Label>
                                            <Input
                                                placeholder="e.g. your.email@gmail.com"
                                                value={smtpSettings.smtp_user}
                                                onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_user: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">SMTP Password</Label>
                                            <Input
                                                type="password"
                                                placeholder="App password or secret"
                                                value={smtpSettings.smtp_pass}
                                                onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_pass: e.target.value })}
                                                className="bg-background"
                                            />
                                            <p className="text-xs text-muted-foreground">This will be securely encrypted in the database.</p>
                                        </div>
                                        <div className="space-y-2 sm:col-span-2">
                                            <Label className="text-sm font-medium">Sender Email Address</Label>
                                            <Input
                                                placeholder="e.g. no-reply@cloudpi.com"
                                                value={smtpSettings.smtp_from_email}
                                                onChange={(e) => setSmtpSettings({ ...smtpSettings, smtp_from_email: e.target.value })}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <Button onClick={handleSaveSmtpSettings} disabled={isSaving} className="gap-2">
                                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                            Save Settings
                                        </Button>
                                        <Button variant="outline" onClick={handleTestSmtp} disabled={isTestingSmtp || !smtpSettings.smtp_host} className="gap-2 border-primary/20 text-primary hover:bg-primary/10">
                                            {isTestingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            Send Test Email
                                        </Button>
                                    </div>
                                    
                                    {(saveMessage || smtpTestMessage) && (
                                        <span className={`text-sm flex items-center gap-1 ${
                                            (saveMessage || smtpTestMessage).includes('success') ? 'text-green-500' : 'text-red-500'
                                        }`}>
                                            {(saveMessage || smtpTestMessage).includes('success') && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                                            {saveMessage || smtpTestMessage}
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}
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
