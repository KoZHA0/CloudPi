"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, Bell, CheckCheck, HardDrive, Inbox, Loader2, Share2, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
    clearReadNotifications,
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    type NotificationItem,
} from "@/lib/api"
import { notifyNotificationsChanged } from "@/components/notification-bell"

const PAGE_SIZE = 25

function formatDate(value: string): string {
    return new Date(value).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function typeLabel(type: string): string {
    if (type === "storage.quota_changed") return "Quota changed"
    if (type === "storage.warning_80") return "Storage warning"
    if (type === "storage.warning_95") return "Storage almost full"
    if (type === "storage.quota_reached") return "Quota reached"
    if (type === "share.received") return "Share received"
    if (type === "share.revoked") return "Share revoked"
    return "Notification"
}

function iconClass(type: string): string {
    if (type === "storage.quota_reached") return "bg-destructive/10 text-destructive"
    if (type.startsWith("storage.")) return "bg-amber-500/10 text-amber-600 dark:text-amber-300"
    return "bg-primary/10 text-primary"
}

function NotificationIcon({ type }: { type: string }) {
    if (type === "storage.quota_reached") return <AlertTriangle className="h-5 w-5" />
    if (type.startsWith("storage.")) return <HardDrive className="h-5 w-5" />
    return <Share2 className="h-5 w-5" />
}

export function NotificationsContent() {
    const navigate = useNavigate()
    const [notifications, setNotifications] = useState<NotificationItem[]>([])
    const [total, setTotal] = useState(0)
    const [unreadCount, setUnreadCount] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [isMarkingAll, setIsMarkingAll] = useState(false)
    const [isClearingRead, setIsClearingRead] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        loadNotifications(0)
    }, [])

    async function loadNotifications(offset: number) {
        const loadingMore = offset > 0
        if (loadingMore) {
            setIsLoadingMore(true)
        } else {
            setIsLoading(true)
        }
        setError(null)

        try {
            const data = await getNotifications({ limit: PAGE_SIZE, offset })
            setTotal(data.total)
            setUnreadCount(data.unreadCount)
            setNotifications((current) => offset === 0 ? data.notifications : [...current, ...data.notifications])
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load notifications")
        } finally {
            setIsLoading(false)
            setIsLoadingMore(false)
        }
    }

    async function handleNotificationClick(notification: NotificationItem) {
        try {
            if (!notification.read_at) {
                const data = await markNotificationRead(notification.id)
                setUnreadCount(data.unreadCount)
                setNotifications((current) =>
                    current.map((item) => item.id === notification.id ? data.notification : item)
                )
                notifyNotificationsChanged()
            }
        } catch {
            // Keep navigation responsive even if read state cannot be updated.
        }

        if (notification.link) {
            navigate(notification.link)
        }
    }

    async function markOneRead(notification: NotificationItem) {
        if (notification.read_at) return
        const data = await markNotificationRead(notification.id)
        setUnreadCount(data.unreadCount)
        setNotifications((current) =>
            current.map((item) => item.id === notification.id ? data.notification : item)
        )
        notifyNotificationsChanged()
    }

    async function handleMarkAllRead() {
        setIsMarkingAll(true)
        try {
            const data = await markAllNotificationsRead()
            setUnreadCount(data.unreadCount)
            const readAt = new Date().toISOString()
            setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })))
            notifyNotificationsChanged()
        } finally {
            setIsMarkingAll(false)
        }
    }

    async function handleClearRead() {
        setIsClearingRead(true)
        setError(null)
        try {
            const data = await clearReadNotifications()
            setUnreadCount(data.unreadCount)
            setTotal((current) => Math.max(data.unreadCount, current - data.deleted))
            setNotifications((current) => current.filter((item) => !item.read_at))
            notifyNotificationsChanged()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to clear read notifications")
        } finally {
            setIsClearingRead(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const readCount = Math.max(0, total - unreadCount)

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <Bell className="h-6 w-6 text-primary" />
                        Notifications
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Share activity, storage warnings, and important account updates will appear here.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{total} total</Badge>
                    <Badge variant={unreadCount > 0 ? "default" : "outline"}>{unreadCount} unread</Badge>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleMarkAllRead}
                        disabled={unreadCount === 0 || isMarkingAll}
                    >
                        {isMarkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                        Mark all as read
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-destructive hover:text-destructive"
                        onClick={handleClearRead}
                        disabled={readCount === 0 || isClearingRead}
                    >
                        {isClearingRead ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        Clear read
                    </Button>
                </div>
            </div>

            {error && (
                <Card className="border-destructive bg-destructive/10">
                    <CardContent className="py-3">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {notifications.length === 0 ? (
                <Card className="py-14">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Inbox className="mb-4 h-14 w-14 text-muted-foreground" />
                        <h3 className="text-lg font-medium">You're all caught up</h3>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                            When someone shares a file with you, or removes access, it will show up here.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <Card className="overflow-hidden border-border bg-card">
                    <CardHeader className="border-b border-border">
                        <CardTitle className="text-base">History</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {notifications.map((notification) => {
                            const unread = !notification.read_at
                            return (
                                <div
                                    key={notification.id}
                                    className={cn(
                                        "flex flex-col gap-3 border-b border-border p-4 last:border-0 sm:flex-row sm:items-start sm:justify-between",
                                        unread && "bg-primary/5"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleNotificationClick(notification)}
                                        className="flex min-w-0 flex-1 gap-3 text-left"
                                    >
                                        <span className={cn("mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full", iconClass(notification.type))}>
                                            <NotificationIcon type={notification.type} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold text-card-foreground">{notification.title}</span>
                                                {unread && <span className="h-2 w-2 rounded-full bg-primary" />}
                                            </span>
                                            <span className="mt-1 block text-sm text-muted-foreground">{notification.body}</span>
                                            <span className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                <Badge variant="outline">{typeLabel(notification.type)}</Badge>
                                                {formatDate(notification.created_at)}
                                            </span>
                                        </span>
                                    </button>
                                    <div className="flex justify-end gap-2 sm:shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={!unread}
                                            onClick={() => markOneRead(notification)}
                                        >
                                            Mark read
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            {notifications.length < total && (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        onClick={() => loadNotifications(notifications.length)}
                        disabled={isLoadingMore}
                        className="gap-2"
                    >
                        {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                        Load more
                    </Button>
                </div>
            )}
        </div>
    )
}
