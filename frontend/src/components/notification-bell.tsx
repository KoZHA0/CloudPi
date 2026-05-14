"use client"

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, Bell, CheckCheck, HardDrive, Inbox, Loader2, Share2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, formatApiDateTime } from "@/lib/utils"
import {
    getNotifications,
    getUnreadNotificationCount,
    markAllNotificationsRead,
    markNotificationRead,
    type NotificationItem,
} from "@/lib/api"

const NOTIFICATIONS_UPDATED_EVENT = "cloudpi-notifications-updated"

function formatNotificationDate(value: string): string {
    return formatApiDateTime(value, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function notificationIconClass(type: string) {
    if (type === "storage.quota_reached") return "bg-destructive/10 text-destructive"
    if (type.startsWith("storage.")) return "bg-amber-500/10 text-amber-600 dark:text-amber-300"
    if (type.startsWith("share.")) return "bg-primary/10 text-primary"
    return "bg-secondary text-muted-foreground"
}

function notificationCategory(type: string) {
    if (type.startsWith("storage.")) return "Storage"
    if (type.startsWith("share.")) return "Share"
    return "System"
}

function NotificationIcon({ type }: { type: string }) {
    if (type === "storage.quota_reached") return <AlertTriangle className="h-4 w-4" />
    if (type.startsWith("storage.")) return <HardDrive className="h-4 w-4" />
    return <Share2 className="h-4 w-4" />
}

export function notifyNotificationsChanged() {
    window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT))
}

export function NotificationBell() {
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)
    const [notifications, setNotifications] = useState<NotificationItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isMarkingAll, setIsMarkingAll] = useState(false)

    const refreshUnreadCount = useCallback(async () => {
        try {
            const data = await getUnreadNotificationCount()
            setUnreadCount(data.unreadCount)
        } catch {
            setUnreadCount(0)
        }
    }, [])

    const loadLatestNotifications = useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await getNotifications({ limit: 10 })
            setNotifications(data.notifications)
            setUnreadCount(data.unreadCount)
        } catch {
            setNotifications([])
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        refreshUnreadCount()
        const interval = window.setInterval(refreshUnreadCount, 30000)
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshUnreadCount)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshUnreadCount)
        }
    }, [refreshUnreadCount])

    useEffect(() => {
        if (open) {
            loadLatestNotifications()
        }
    }, [open, loadLatestNotifications])

    async function openNotification(notification: NotificationItem) {
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
            // Navigation still matters even if read-state update failed.
        }

        setOpen(false)
        if (notification.link) {
            navigate(notification.link)
        }
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

    function openAllNotifications() {
        setOpen(false)
        navigate("/notifications")
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-sm p-0">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                        <p className="font-semibold text-popover-foreground">Notifications</p>
                        <p className="text-xs text-muted-foreground">
                            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        disabled={unreadCount === 0 || isMarkingAll}
                        onClick={handleMarkAllRead}
                    >
                        {isMarkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                        <span className="hidden sm:inline">Mark all</span>
                    </Button>
                </div>

                <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex h-28 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                            <Inbox className="mb-3 h-10 w-10 text-muted-foreground" />
                            <p className="font-medium">You're all caught up</p>
                            <p className="text-sm text-muted-foreground">New shares will appear here.</p>
                        </div>
                    ) : (
                        notifications.map((notification) => {
                            const unread = !notification.read_at
                            return (
                                <button
                                    key={notification.id}
                                    type="button"
                                    onClick={() => openNotification(notification)}
                                    className={cn(
                                        "flex w-full gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-secondary/70",
                                        unread && "bg-primary/5"
                                    )}
                                >
                                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", notificationIconClass(notification.type))}>
                                        <NotificationIcon type={notification.type} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium text-popover-foreground">{notification.title}</span>
                                            {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                                        </span>
                                        <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>
                                        <span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{notificationCategory(notification.type)}</Badge>
                                            {formatNotificationDate(notification.created_at)}
                                        </span>
                                    </span>
                                </button>
                            )
                        })
                    )}
                </div>

                <div className="border-t border-border p-2">
                    <Button variant="ghost" className="w-full justify-center" onClick={openAllNotifications}>
                        View all
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
