"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Folder,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Link2,
    Eye,
    Trash2,
    Loader2,
    ArrowUpRight,
    ArrowDownLeft,
    Download,
    ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    getMyShares,
    getSharedWithMe,
    revokeShare,
    type ShareItem,
} from "@/lib/api"

const API_BASE = `http://${window.location.hostname}:3001/api`

const getFileIcon = (type: string) => {
    const icons: Record<string, typeof FileText> = {
        folder: Folder,
        document: FileText,
        image: ImageIcon,
        video: Video,
        audio: Music,
        archive: Archive,
    }
    return icons[type] || FileText
}

const getFileColor = (type: string) => {
    const colors: Record<string, string> = {
        folder: "text-blue-400",
        document: "text-red-400",
        image: "text-green-400",
        video: "text-purple-400",
        audio: "text-yellow-400",
        archive: "text-orange-400",
    }
    return colors[type] || "text-gray-400"
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "—"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(dateString: string): string {
    // SQLite CURRENT_TIMESTAMP is UTC but lacks 'Z' suffix
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

export function SharedContent() {
    const [tab, setTab] = useState<"my-shares" | "shared-with-me">("shared-with-me")
    const [myShares, setMyShares] = useState<ShareItem[]>([])
    const [sharedWithMe, setSharedWithMe] = useState<ShareItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [revokeTarget, setRevokeTarget] = useState<ShareItem | null>(null)

    useEffect(() => {
        loadShares()
    }, [])

    async function loadShares() {
        setIsLoading(true)
        setError(null)
        try {
            const [myData, withMeData] = await Promise.all([
                getMyShares(),
                getSharedWithMe(),
            ])
            setMyShares(myData.shares)
            setSharedWithMe(withMeData.shares)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shares")
        } finally {
            setIsLoading(false)
        }
    }

    async function handleRevoke() {
        if (!revokeTarget) return
        try {
            await revokeShare(revokeTarget.id)
            setRevokeTarget(null)
            loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to revoke share")
        }
    }

    async function handleDownloadShared(share: ShareItem) {
        // Download via public share link (since user doesn't own the file)
        window.open(`${API_BASE}/shares/public/${share.share_link}/download`, '_blank')
    }

    const currentList = tab === "my-shares" ? myShares : sharedWithMe

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Link2 className="h-6 w-6" />
                        Shared Files
                    </h1>
                    <p className="text-muted-foreground">Share files with other CloudPi users</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary p-1 rounded-lg w-fit">
                <Button
                    variant={tab === "shared-with-me" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setTab("shared-with-me")}
                    className="gap-2"
                >
                    <ArrowDownLeft className="h-4 w-4" />
                    Shared with me
                    {sharedWithMe.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                            {sharedWithMe.length}
                        </Badge>
                    )}
                </Button>
                <Button
                    variant={tab === "my-shares" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setTab("my-shares")}
                    className="gap-2"
                >
                    <ArrowUpRight className="h-4 w-4" />
                    My shares
                    {myShares.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                            {myShares.length}
                        </Badge>
                    )}
                </Button>
            </div>

            {error && (
                <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {currentList.length === 0 && !error ? (
                <Card className="bg-card border-border">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <Link2 className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium text-card-foreground">
                            {tab === "shared-with-me"
                                ? "No files shared with you"
                                : "You haven't shared any files"}
                        </h3>
                        <p className="text-muted-foreground mt-1 max-w-sm">
                            {tab === "shared-with-me"
                                ? "When someone shares a file with you, it will appear here."
                                : "Share a file from the Files page using the Share option in the file menu."}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {currentList.map((share) => {
                        const Icon = getFileIcon(share.file_type)
                        return (
                            <Card key={share.id} className="bg-card border-border">
                                <CardContent className="p-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                        {/* File info */}
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="rounded-lg bg-secondary p-2.5 shrink-0">
                                                <Icon className={cn("h-5 w-5", getFileColor(share.file_type))} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-card-foreground truncate">
                                                    {share.file_name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatFileSize(share.file_size)} · {formatDate(share.created_at)}
                                                    {tab === "my-shares" && share.shared_with_name && (
                                                        <> · Shared with <span className="font-medium text-card-foreground">{share.shared_with_name}</span></>
                                                    )}
                                                    {tab === "shared-with-me" && share.shared_by_name && (
                                                        <> · From <span className="font-medium text-card-foreground">{share.shared_by_name}</span></>
                                                    )}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 ml-auto">
                                            <Badge variant="secondary" className="bg-primary/10 text-primary border-0 shrink-0">
                                                <Eye className="mr-1 h-3 w-3" />
                                                {share.permission}
                                            </Badge>

                                            {tab === "shared-with-me" && share.file_type !== "folder" && (
                                                <>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1.5"
                                                        onClick={() => window.open(`${API_BASE}/shares/public/${share.share_link}/preview`, '_blank')}
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">View</span>
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1.5"
                                                        onClick={() => handleDownloadShared(share)}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">Download</span>
                                                    </Button>
                                                </>
                                            )}

                                            {tab === "my-shares" && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                                    onClick={() => setRevokeTarget(share)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Revoke Confirmation */}
            <AlertDialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Stop Sharing?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{revokeTarget?.file_name}" will no longer be shared with {revokeTarget?.shared_with_name || "this user"}.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRevoke}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Stop Sharing
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
