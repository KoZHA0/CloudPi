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
import { Bell, Palette, HardDrive, Trash2, Server, Loader2, Shield, Save, CheckCircle2, Mail, Send, Lock } from "lucide-react"
import { getDashboardStats, getSystemHealth, getRateLimitSettings, updateSettings, testSmtpSettings, getEncryptionStats, getNotificationPreferences, updateNotificationPreferences, getStorageStats, type DashboardStats, type RateLimitSettings, type SystemHealth, type EncryptionStats, type NotificationPreferences, type StorageStats } from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"
import { useTheme } from "@/contexts/theme-context"

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
    const { theme, setTheme } = useTheme()
    const isAdmin = user?.is_admin === 1

    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [health, setHealth] = useState<SystemHealth | null>(null)
    const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Rate limit settings (admin only)
    const [rateLimits, setRateLimits] = useState({
        rate_limit_api_enabled: '1',
        rate_limit_api_max: '1000',
        rate_limit_api_window: '15',
        rate_limit_upload_enabled: '1',
        rate_limit_upload_max: '10',
        rate_limit_upload_window: '15',
    })
    const [trashRetentionDays, setTrashRetentionDays] = useState('30')
    const [smtpSettings, setSmtpSettings] = useState({
        smtp_host: '',
        smtp_port: '587',
        smtp_user: '',
        smtp_pass: '',
        smtp_from_email: '',
    })
    const [isSavingRateLimits, setIsSavingRateLimits] = useState(false)
    const [rateLimitMessage, setRateLimitMessage] = useState('')
    const [isSavingTrashRetention, setIsSavingTrashRetention] = useState(false)
    const [trashRetentionMessage, setTrashRetentionMessage] = useState('')
    const [isSavingSmtp, setIsSavingSmtp] = useState(false)
    const [smtpSaveMessage, setSmtpSaveMessage] = useState('')
    const [isTestingSmtp, setIsTestingSmtp] = useState(false)
    const [smtpTestMessage, setSmtpTestMessage] = useState('')

    // Encryption state (admin only)
    const [encryptionStats, setEncryptionStats] = useState<EncryptionStats | null>(null)
    const [isTogglingEncryption, setIsTogglingEncryption] = useState(false)

    const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
        share_notifications: true,
        storage_warnings: true,
    })
    const [isSavingNotifications, setIsSavingNotifications] = useState(false)
    const [notificationMessage, setNotificationMessage] = useState('')

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        try {
            const [statsData, healthData, notificationPrefsData, storageStatsData] = await Promise.all([
                getDashboardStats(),
                getSystemHealth(),
                getNotificationPreferences(),
                getStorageStats().catch(() => null),
            ])

            setStats(statsData)
            setHealth(healthData)
            setStorageStats(storageStatsData)
            setNotificationPreferences(notificationPrefsData.preferences)

            // Set rate limit settings if admin
            if (isAdmin) {
                const [settingsData] = await Promise.all([
                    getRateLimitSettings(),
                ])
                const s: RateLimitSettings = settingsData.settings
                setRateLimits({
                    rate_limit_api_enabled: s.rate_limit_api_enabled?.value || '1',
                    rate_limit_api_max: s.rate_limit_api_max?.value || '1000',
                    rate_limit_api_window: s.rate_limit_api_window?.value || '15',
                    rate_limit_upload_enabled: s.rate_limit_upload_enabled?.value || '1',
                    rate_limit_upload_max: s.rate_limit_upload_max?.value || '10',
                    rate_limit_upload_window: s.rate_limit_upload_window?.value || '15',
                })
                setTrashRetentionDays(s.trash_retention_days?.value || '30')
                setSmtpSettings({
                    smtp_host: s.smtp_host?.value || '',
                    smtp_port: s.smtp_port?.value || '587',
                    smtp_user: s.smtp_user?.value || '',
                    smtp_pass: s.smtp_pass?.value ? '********' : '',
                    smtp_from_email: s.smtp_from_email?.value || '',
                })
                // Load encryption stats
                try {
                    const encStats = await getEncryptionStats()
                    setEncryptionStats(encStats)
                } catch (e) {
                    console.error('Failed to load encryption stats', e)
                }
            }
        } catch (error) {
            console.error("Failed to load settings data", error)
        } finally {
            setIsLoading(false)
        }
    }

    async function handleSaveRateLimits() {
        setIsSavingRateLimits(true)
        setRateLimitMessage('')
        try {
            await updateSettings(rateLimits)
            setRateLimitMessage('Settings saved successfully!')
            setTimeout(() => setRateLimitMessage(''), 3000)
        } catch (error: unknown) {
            setRateLimitMessage(getErrorMessage(error, 'Failed to save settings'))
        } finally {
            setIsSavingRateLimits(false)
        }
    }

    async function handleSaveTrashRetention() {
        const days = Number(trashRetentionDays)
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
            setTrashRetentionMessage('Trash retention must be between 1 and 3650 days')
            return
        }

        setIsSavingTrashRetention(true)
        setTrashRetentionMessage('')
        try {
            await updateSettings({ trash_retention_days: String(days) })
            setTrashRetentionDays(String(days))
            setTrashRetentionMessage('Trash retention saved successfully!')
            setTimeout(() => setTrashRetentionMessage(''), 3000)
        } catch (error: unknown) {
            setTrashRetentionMessage(getErrorMessage(error, 'Failed to save trash retention'))
        } finally {
            setIsSavingTrashRetention(false)
        }
    }

    async function handleSaveSmtpSettings() {
        setIsSavingSmtp(true)
        setSmtpSaveMessage('')
        setSmtpTestMessage('')
        try {
            await updateSettings(smtpSettings)
            setSmtpSaveMessage('Email settings saved successfully!')
            setTimeout(() => setSmtpSaveMessage(''), 3000)
        } catch (error: unknown) {
            setSmtpSaveMessage(getErrorMessage(error, 'Failed to save email settings'))
        } finally {
            setIsSavingSmtp(false)
        }
    }

    async function handleTestSmtp() {
        setIsTestingSmtp(true)
        setSmtpTestMessage('')
        setSmtpSaveMessage('')
        try {
            const result = await testSmtpSettings(smtpSettings)
            setSmtpTestMessage(result.message)
        } catch (error: unknown) {
            setSmtpTestMessage(getErrorMessage(error, 'SMTP test failed'))
        } finally {
            setIsTestingSmtp(false)
        }
    }

    async function handleSaveNotificationPreferences() {
        setIsSavingNotifications(true)
        setNotificationMessage('')
        try {
            const result = await updateNotificationPreferences(notificationPreferences)
            setNotificationPreferences(result.preferences)
            setNotificationMessage('Notification preferences saved successfully!')
            setTimeout(() => setNotificationMessage(''), 3000)
        } catch (error: unknown) {
            setNotificationMessage(getErrorMessage(error, 'Failed to save notification preferences'))
        } finally {
            setIsSavingNotifications(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const totalDiskSpace = storageStats?.totalBytes ?? health?.disk.total ?? 0
    const usedStorage = storageStats?.usedBytes ?? stats?.totalStorage ?? 0
    const storagePercent = totalDiskSpace > 0
        ? Math.min(100, Math.round((usedStorage / totalDiskSpace) * 100))
        : 0

    return (
        <div className="min-w-0 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Settings</h1>
                <p className="text-muted-foreground">Manage your personal cloud settings</p>
            </div>

            <Tabs defaultValue="server" className="space-y-6">
                <TabsList className="flex h-auto w-full justify-start overflow-x-auto bg-secondary p-1 sm:w-auto">
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
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <Label className="text-base">Theme</Label>
                                    <p className="text-sm text-muted-foreground">Select your preferred theme</p>
                                </div>
                                <Select value={theme} onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}>
                                    <SelectTrigger className="w-full sm:w-32">
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
                                        {totalDiskSpace > 0
                                            ? `${formatBytes(usedStorage)} / ${formatBytes(totalDiskSpace)}`
                                            : `${formatBytes(usedStorage)} / Unknown`}
                                    </span>
                                </div>
                                <div className="w-full bg-background rounded-full h-2">
                                    <div
                                        className="bg-primary h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${storagePercent}%` }}
                                    />
                                </div>
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

                    {/* Trash Retention (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Trash2 className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-card-foreground">Trash Retention</CardTitle>
                                </div>
                                <CardDescription>Choose how long deleted items stay recoverable</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-3 rounded-lg bg-secondary p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                                    <div className="space-y-1">
                                        <p className="font-medium text-secondary-foreground">Auto-delete from Trash</p>
                                        <p className="text-sm text-muted-foreground">
                                            Expired trash is cleaned automatically when Trash is opened.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Days</Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            max="3650"
                                            value={trashRetentionDays}
                                            onChange={(event) => setTrashRetentionDays(event.target.value)}
                                            className="bg-background"
                                        />
                                    </div>
                                    <Button
                                        onClick={handleSaveTrashRetention}
                                        disabled={isSavingTrashRetention}
                                        className="w-full gap-2 sm:w-auto"
                                    >
                                        {isSavingTrashRetention ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                        Save
                                    </Button>
                                </div>
                                {trashRetentionMessage && (
                                    <p className={`flex items-center gap-1 text-sm ${
                                        trashRetentionMessage.includes('success') ? 'text-green-500' : 'text-red-500'
                                    }`}>
                                        {trashRetentionMessage.includes('success') && <CheckCircle2 className="h-4 w-4" />}
                                        {trashRetentionMessage}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Encryption (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Lock className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-card-foreground">File Encryption</CardTitle>
                                </div>
                                <CardDescription>AES-256-GCM encryption for files stored on disk</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
                                    <div className="space-y-1">
                                        <p className="font-medium text-secondary-foreground">Encrypt new uploads</p>
                                        <p className="text-sm text-muted-foreground">
                                            {encryptionStats?.encryption_enabled
                                                ? 'New files will be encrypted before writing to disk'
                                                : 'New files will be stored as plaintext'}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={encryptionStats?.encryption_enabled ?? false}
                                        disabled={isTogglingEncryption}
                                        onCheckedChange={async (checked) => {
                                            setIsTogglingEncryption(true)
                                            try {
                                                await updateSettings({ encryption_enabled: checked ? '1' : '0' })
                                                const updated = await getEncryptionStats()
                                                setEncryptionStats(updated)
                                            } catch (e) {
                                                console.error('Failed to toggle encryption', e)
                                            } finally {
                                                setIsTogglingEncryption(false)
                                            }
                                        }}
                                    />
                                </div>

                                {encryptionStats && (
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="p-3 rounded-lg bg-secondary text-center">
                                            <p className="text-2xl font-bold text-green-500">{encryptionStats.encrypted_files}</p>
                                            <p className="text-xs text-muted-foreground">Encrypted</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary text-center">
                                            <p className="text-2xl font-bold text-muted-foreground">{encryptionStats.unencrypted_files}</p>
                                            <p className="text-xs text-muted-foreground">Unencrypted</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary text-center">
                                            <p className={`text-2xl font-bold ${encryptionStats.integrity_failed_files > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                {encryptionStats.integrity_failed_files}
                                            </p>
                                            <p className="text-xs text-muted-foreground">Integrity Issues</p>
                                        </div>
                                    </div>
                                )}

                                <p className="text-xs text-muted-foreground">
                                    Existing files are not affected by this toggle. Encrypted files remain encrypted and readable regardless of this setting.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Request Limits (Admin Only) */}
                    {isAdmin && (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Shield className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-card-foreground">Request Limits</CardTitle>
                                </div>
                                <CardDescription>Control API and upload request limits</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* API Rate Limit */}
                                <div className="p-4 rounded-lg bg-secondary space-y-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-medium text-secondary-foreground">API Requests</p>
                                            <p className="text-sm text-muted-foreground">Limits all API calls per IP address</p>
                                        </div>
                                        <Switch
                                            checked={rateLimits.rate_limit_api_enabled === '1'}
                                            onCheckedChange={(checked) => setRateLimits({
                                                ...rateLimits,
                                                rate_limit_api_enabled: checked ? '1' : '0',
                                            })}
                                            className="shrink-0"
                                        />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Max requests</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="10000"
                                                value={rateLimits.rate_limit_api_max}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_api_max: e.target.value })}
                                                disabled={rateLimits.rate_limit_api_enabled !== '1'}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Window (minutes)</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1440"
                                                value={rateLimits.rate_limit_api_window}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_api_window: e.target.value })}
                                                disabled={rateLimits.rate_limit_api_enabled !== '1'}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Upload Rate Limit */}
                                <div className="p-4 rounded-lg bg-secondary space-y-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-medium text-secondary-foreground">File Uploads</p>
                                            <p className="text-sm text-muted-foreground">Limits upload requests per IP to protect disk I/O</p>
                                        </div>
                                        <Switch
                                            checked={rateLimits.rate_limit_upload_enabled === '1'}
                                            onCheckedChange={(checked) => setRateLimits({
                                                ...rateLimits,
                                                rate_limit_upload_enabled: checked ? '1' : '0',
                                            })}
                                            className="shrink-0"
                                        />
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Max uploads</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="10000"
                                                value={rateLimits.rate_limit_upload_max}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_upload_max: e.target.value })}
                                                disabled={rateLimits.rate_limit_upload_enabled !== '1'}
                                                className="bg-background"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">Window (minutes)</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="1440"
                                                value={rateLimits.rate_limit_upload_window}
                                                onChange={(e) => setRateLimits({ ...rateLimits, rate_limit_upload_window: e.target.value })}
                                                disabled={rateLimits.rate_limit_upload_enabled !== '1'}
                                                className="bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Save Button */}
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                    <Button onClick={handleSaveRateLimits} disabled={isSavingRateLimits} className="w-full gap-2 sm:w-auto">
                                        {isSavingRateLimits ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                        {isSavingRateLimits ? 'Saving...' : 'Save Changes'}
                                    </Button>
                                    {rateLimitMessage && (
                                        <span className={`text-sm flex items-center gap-1 ${
                                            rateLimitMessage.includes('success') ? 'text-green-500' : 'text-red-500'
                                        }`}>
                                            {rateLimitMessage.includes('success') && <CheckCircle2 className="h-4 w-4" />}
                                            {rateLimitMessage}
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

                                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <Button onClick={handleSaveSmtpSettings} disabled={isSavingSmtp} className="w-full gap-2 sm:w-auto">
                                            {isSavingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                            Save Settings
                                        </Button>
                                        <Button variant="outline" onClick={handleTestSmtp} disabled={isTestingSmtp || !smtpSettings.smtp_host} className="w-full gap-2 border-primary/20 text-primary hover:bg-primary/10 sm:w-auto">
                                            {isTestingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            Send Test Email
                                        </Button>
                                    </div>
                                    
                                    {(smtpSaveMessage || smtpTestMessage) && (
                                        <span className={`text-sm flex items-center gap-1 ${
                                            (smtpSaveMessage || smtpTestMessage).includes('success') ? 'text-green-500' : 'text-red-500'
                                        }`}>
                                            {(smtpSaveMessage || smtpTestMessage).includes('success') && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                                            {smtpSaveMessage || smtpTestMessage}
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
                            <CardDescription>Choose which in-app notifications CloudPi should create</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col gap-3 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="space-y-1">
                                    <Label className="text-base text-secondary-foreground">Share notifications</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Notify me when someone shares something with me or removes my access.
                                    </p>
                                </div>
                                <Switch
                                    checked={notificationPreferences.share_notifications}
                                    onCheckedChange={(checked) => setNotificationPreferences({
                                        ...notificationPreferences,
                                        share_notifications: checked,
                                    })}
                                    className="shrink-0"
                                />
                            </div>
                            <Separator />
                            <div className="flex flex-col gap-3 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="space-y-1">
                                    <Label className="text-base text-secondary-foreground">Storage warnings</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Notify me when my storage quota is close to full or reached.
                                    </p>
                                </div>
                                <Switch
                                    checked={notificationPreferences.storage_warnings}
                                    onCheckedChange={(checked) => setNotificationPreferences({
                                        ...notificationPreferences,
                                        storage_warnings: checked,
                                    })}
                                    className="shrink-0"
                                />
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <Button onClick={handleSaveNotificationPreferences} disabled={isSavingNotifications} className="w-full gap-2 sm:w-auto">
                                    {isSavingNotifications ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Save Preferences
                                </Button>
                                {notificationMessage && (
                                    <span className={`flex items-center gap-1 text-sm ${
                                        notificationMessage.includes('success') ? 'text-green-500' : 'text-red-500'
                                    }`}>
                                        {notificationMessage.includes('success') && <CheckCircle2 className="h-4 w-4" />}
                                        {notificationMessage}
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
